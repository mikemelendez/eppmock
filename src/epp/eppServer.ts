import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";
import type { AppConfig } from "../config.js";
import { isTlsEnabled } from "../config.js";
import { EppFrameDecoder, encodeFrame } from "./framing.js";
import { greeting, resultResponse } from "./responses.js";
import { TlsWireCertGuard } from "./tlsWireCertGuard.js";
import type { EppSession } from "./types.js";

/**
 * Anything that can turn a raw EPP frame into a response frame.
 */
export interface EppRouter {
  route(rawXml: string, session: EppSession): Promise<string>;
}

export interface EppServerOptions {
  host: string;
  port: number;
  label: string;
  exitOnError?: boolean;
  /** When set, overrides `isTlsEnabled(config)` for this listener. */
  tls?: boolean;
}

interface PeerCertSummary {
  index: number;
  role: "leaf" | "chain";
  fingerprint256: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  pem: string;
}

/**
 * TLS 1.2 cipher suites recommended by RFC 9325 §4.2. TLS 1.3 suites are
 * negotiated separately by Node and are already AEAD-only.
 */
export const RFC_9325_TLS12_CIPHERS = [
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305"
].join(":");

/**
 * TEMPORARY DEBUG: accept only the normal RST client cert presentations seen in
 * production logs (client01 / client02 leaf + canonical Sectigo chain). Reject
 * variations (leaf-only, alternate root, extraneous/self-signed, missing cert).
 * Remove after debugging.
 */
const TEMP_DEBUG_ALLOWED_LEAF_SHA256 = new Set([
  // epp-client01.rst-api-qa.icann.org
  "186f14d5dd016c97bee0d44ccf705af720897aef724824049c8dd9f027e8106b",
  // epp-client02.rst-api-qa.icann.org
  "4349d0f567d1f9b12f7609fc4e885089021a519e64c3200ef3b6441959186cf8"
]);

/** Canonical intermediates+root for the normal RST presentations (chainLength === 4). */
const TEMP_DEBUG_CANONICAL_CHAIN_SHA256 = [
  "6542d176bed50f193c0ce297ae44ecd8a0a86bec2ede682769344059b4e78530", // Sectigo Public Server Authentication CA OV R36
  "92f351bf3d54164dfa8dd8f9e1139d3150349786485d2b9eecd00e2971c1e6c5", // Sectigo Public Server Authentication Root R46
  "68b9c761219a5b1f0131784474665db61bbdb109e00f05ca9f74244ee5f5f52b" // USERTrust RSA Certification Authority (Comodo-issued)
];

const TEMP_DEBUG_KNOWN_CHAIN_SHA256 = new Set(TEMP_DEBUG_CANONICAL_CHAIN_SHA256);

export function startEppServer(config: AppConfig, router: EppRouter, options?: Partial<EppServerOptions>): net.Server {
  // options.tls=false is how the dashboard listener stays plaintext while EPP_PORT is TLS.
  const resolved: EppServerOptions = {
    host: options?.host ?? config.eppHost,
    port: options?.port ?? config.eppPort,
    label: options?.label ?? "EPP testing tool",
    exitOnError: options?.exitOnError ?? true,
    tls: options?.tls ?? isTlsEnabled(config)
  };

  // TEMPORARY DEBUG: wire-inspect client Certificate (cleartext only on TLS 1.2).
  // Production listener only — local tests keep TLS 1.2–1.3 via exitOnError=false.
  const wireGuardEnabled = Boolean(resolved.tls && resolved.exitOnError);

  const onSecureConnection = (socket: net.Socket): void => {
    const sessionId = randomUUID();
    const chain = resolved.tls ? collectPeerCertificateChain(socket) : [];
    const presented = chain[0]?.fingerprint256;

    if (resolved.tls) {
      logClientCertificateChain(socket as tls.TLSSocket, {
        label: resolved.label,
        sessionId,
        remote: formatRemote(socket),
        chain
      });

      // TEMPORARY DEBUG: post-handshake filter for variations OpenSSL still exposes
      // (leaf-only / alternate root / missing). Extraneous/unordered that OpenSSL
      // normalizes are denied earlier by TlsWireCertGuard.
      if (resolved.exitOnError && !isLoopbackRemote(socket)) {
        const decision = temporaryDebugCertDecision(chain);
        if (!decision.accept) {
          console.log(
            `${resolved.label} TEMPORARY DEBUG rejecting cert variation` +
              ` session=${sessionId} remote=${formatRemote(socket)}` +
              ` reason=${decision.reason}` +
              ` leaf=${presented ?? "(none)"} chainLength=${chain.length}`
          );
          socket.destroy();
          return;
        }

        console.log(
          `${resolved.label} TEMPORARY DEBUG accepting normal client cert` +
            ` session=${sessionId} remote=${formatRemote(socket)}` +
            ` leaf=${presented} chainLength=${chain.length}`
        );
      }
    }

    const decoder = new EppFrameDecoder();
    const session: EppSession = {
      id: sessionId,
      authenticated: false,
      tls: resolved.tls,
      connectedAt: new Date(),
      lastCommandAt: new Date(),
      clientCertSha256: presented
    };

    socket.write(encodeFrame(greeting(config.greetingServerId)));

    socket.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      void handleChunk(buffer, decoder, session, socket, router);
    });

    socket.on("error", (error) => {
      console.error(`${resolved.label} socket error`, error);
    });
  };

  const server = resolved.tls
    ? createTlsEppServer(config, resolved, wireGuardEnabled, onSecureConnection)
    : net.createServer(onSecureConnection);

  server.on("error", (error: NodeJS.ErrnoException) => {
    const hint =
      error.code === "EADDRINUSE"
        ? ` (port ${resolved.port} is already in use; on macOS the AirPlay Receiver and Control Center listen on 7000 \u2014 disable it or set the port)`
        : "";
    console.error(`${resolved.label} failed to start on ${resolved.host}:${resolved.port}${hint}:`, error.message);

    if (resolved.exitOnError) {
      process.exitCode = 1;
    }
  });

  server.listen(resolved.port, resolved.host, () => {
    const mode = resolved.tls ? "TLS" : "TCP";
    console.log(`${resolved.label} listening on ${resolved.host}:${resolved.port} (${mode})`);
    if (wireGuardEnabled) {
      console.log(
        `${resolved.label} TEMPORARY DEBUG wire-denying RST extraneous/unordered client certs` +
          ` (TLS 1.2 cleartext Certificate); post-handshake filter still rejects other variations`
      );
    }
  });

  return server;
}

/**
 * Accept TCP, optionally wrap with TlsWireCertGuard, then complete TLS.
 * maxVersion is forced to TLS 1.2 when the wire guard is on so the client
 * Certificate message stays cleartext (TLS 1.3 encrypts it).
 */
function createTlsEppServer(
  config: AppConfig,
  resolved: EppServerOptions,
  wireGuardEnabled: boolean,
  onSecureConnection: (socket: tls.TLSSocket) => void
): net.Server {
  const tlsOptions: tls.TLSSocketOptions = {
    cert: readFileSync(config.eppTlsCertPath as string),
    key: readFileSync(config.eppTlsKeyPath as string),
    ca: config.eppTlsCaPath ? readFileSync(config.eppTlsCaPath) : undefined,
    requestCert: config.eppTlsRequireClientCert,
    rejectUnauthorized: false,
    minVersion: "TLSv1.2",
    maxVersion: wireGuardEnabled ? "TLSv1.2" : "TLSv1.3",
    honorCipherOrder: true,
    ciphers: RFC_9325_TLS12_CIPHERS,
    isServer: true
  };

  return net.createServer((rawSocket) => {
    // Wire guard runs on every connection (including loopback). Empty client
    // Certificate lists are allowed so local health checks still complete.
    const transport = wireGuardEnabled
      ? new TlsWireCertGuard(rawSocket, {
          allowedLeafSha256: TEMP_DEBUG_ALLOWED_LEAF_SHA256,
          knownChainSha256: TEMP_DEBUG_KNOWN_CHAIN_SHA256,
          label: resolved.label
        })
      : rawSocket;

    const tlsSocket = new tls.TLSSocket(transport, tlsOptions);

    tlsSocket.once("secure", () => {
      onSecureConnection(tlsSocket);
    });

    tlsSocket.on("error", (error) => {
      // Expected when the wire guard destroys mid-handshake; avoid crashing.
      if (wireGuardEnabled && /socket|ECONNRESET|closed|destroyed/i.test(String(error.message))) {
        return;
      }
      console.error(`${resolved.label} TLS socket error`, error);
    });
  });
}

/** TEMPORARY DEBUG: normal client01/02 leaf + canonical 4-cert chain only. */
function temporaryDebugCertDecision(chain: PeerCertSummary[]): { accept: boolean; reason: string } {
  if (chain.length === 0) {
    return { accept: false, reason: "missing-client-cert" };
  }

  const leaf = chain[0]?.fingerprint256 ?? "";
  if (!TEMP_DEBUG_ALLOWED_LEAF_SHA256.has(leaf)) {
    return { accept: false, reason: "unknown-or-extraneous-leaf" };
  }

  // Leaf-only (and many stripped extraneous presentations) show chainLength=1.
  if (chain.length !== 4) {
    return { accept: false, reason: `non-canonical-chain-length-${chain.length}` };
  }

  for (let i = 0; i < TEMP_DEBUG_CANONICAL_CHAIN_SHA256.length; i += 1) {
    const expected = TEMP_DEBUG_CANONICAL_CHAIN_SHA256[i];
    const actual = chain[i + 1]?.fingerprint256;
    if (actual !== expected) {
      return {
        accept: false,
        reason: `non-canonical-chain-cert-${i + 1}`
      };
    }
  }

  return { accept: true, reason: "normal-rst-client-chain" };
}

/** Walk getPeerCertificate(true) and return leaf-first summaries (including PEM). */
function collectPeerCertificateChain(socket: net.Socket): PeerCertSummary[] {
  if (!("getPeerCertificate" in socket) || typeof socket.getPeerCertificate !== "function") {
    return [];
  }

  const detailed = (socket as tls.TLSSocket).getPeerCertificate(true);
  if (!detailed || Object.keys(detailed).length === 0) {
    return [];
  }

  const chain: PeerCertSummary[] = [];
  const seen = new Set<object>();
  let current: tls.DetailedPeerCertificate | tls.PeerCertificate | undefined = detailed;

  while (current && Object.keys(current).length > 0 && !seen.has(current)) {
    seen.add(current);

    if (!("fingerprint256" in current) || !current.fingerprint256) {
      break;
    }

    chain.push({
      index: chain.length,
      role: chain.length === 0 ? "leaf" : "chain",
      fingerprint256: normalizeFingerprint(String(current.fingerprint256)) ?? "",
      subject: formatCertName(current.subject),
      issuer: formatCertName(current.issuer),
      serialNumber: String(current.serialNumber ?? ""),
      validFrom: String(current.valid_from ?? ""),
      validTo: String(current.valid_to ?? ""),
      pem: rawToPem(current.raw)
    });

    const next: tls.DetailedPeerCertificate | tls.PeerCertificate | undefined =
      "issuerCertificate" in current ? current.issuerCertificate : undefined;
    if (!next || next === current) {
      break;
    }
    current = next;
  }

  return chain;
}

/** Log every peer cert Node exposes after the handshake (leaf + chain). */
function logClientCertificateChain(
  socket: tls.TLSSocket,
  meta: { label: string; sessionId: string; remote: string; chain?: PeerCertSummary[] }
): void {
  const chain = meta.chain ?? collectPeerCertificateChain(socket);
  const authorized = socket.authorized;
  const authorizationError = socket.authorizationError
    ? String(socket.authorizationError)
    : undefined;
  const alpn = socket.alpnProtocol ? String(socket.alpnProtocol) : undefined;
  const cipher = socket.getCipher();

  console.log(
    `${meta.label} TLS client cert session=${meta.sessionId} remote=${meta.remote}` +
      ` authorized=${authorized}` +
      (authorizationError ? ` authorizationError=${authorizationError}` : "") +
      ` chainLength=${chain.length}` +
      (cipher ? ` cipher=${cipher.name}` : "") +
      (alpn ? ` alpn=${alpn}` : "")
  );

  if (chain.length === 0) {
    console.log(`${meta.label} TLS client cert session=${meta.sessionId} (no peer certificate presented)`);
    return;
  }

  for (const cert of chain) {
    console.log(
      `${meta.label} TLS client cert session=${meta.sessionId}` +
        ` [${cert.index}:${cert.role}]` +
        ` sha256=${cert.fingerprint256}` +
        ` subject=${cert.subject}` +
        ` issuer=${cert.issuer}` +
        ` serial=${cert.serialNumber}` +
        ` notBefore=${cert.validFrom}` +
        ` notAfter=${cert.validTo}`
    );
    console.log(
      `${meta.label} TLS client cert session=${meta.sessionId} [${cert.index}:${cert.role}] pem=\n${cert.pem}`
    );
  }
}

function formatRemote(socket: net.Socket): string {
  const host = socket.remoteAddress ?? "?";
  const port = socket.remotePort ?? "?";
  return `${host}:${port}`;
}

function isLoopbackRemote(socket: net.Socket): boolean {
  const host = socket.remoteAddress ?? "";
  return host === "127.0.0.1" || host === "::1" || host === "::ffff:127.0.0.1";
}

function formatCertName(name: tls.PeerCertificate["subject"] | undefined): string {
  if (!name || typeof name !== "object") {
    return "";
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(name)) {
    if (typeof value === "string" && value) {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(", ");
}

function rawToPem(raw: Buffer | undefined): string {
  if (!raw || raw.length === 0) {
    return "";
  }

  const body = raw.toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

function normalizeFingerprint(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replaceAll(":", "").replaceAll(" ", "").toLowerCase();
}

async function handleChunk(
  chunk: Buffer,
  decoder: EppFrameDecoder,
  session: EppSession,
  socket: net.Socket,
  router: EppRouter
): Promise<void> {
  try {
    const messages = decoder.push(chunk);

    for (const message of messages) {
      session.lastCommandAt = new Date();
      const response = await router.route(message, session);
      socket.write(encodeFrame(response));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    socket.write(encodeFrame(resultResponse(2400, message)));
  }
}
