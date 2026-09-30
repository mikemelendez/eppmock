import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import tls from "node:tls";
import type { AppConfig } from "../config.js";
import { isTlsEnabled } from "../config.js";
import { EppFrameDecoder, encodeFrame } from "./framing.js";
import { greeting, resultResponse } from "./responses.js";
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

/** TEMPORARY DEBUG: accept only the first N public TLS connects, then drop the rest. */
const TEMP_DEBUG_TLS_ACCEPT_LIMIT = 3;

export function startEppServer(config: AppConfig, router: EppRouter, options?: Partial<EppServerOptions>): net.Server {
  // options.tls=false is how the dashboard listener stays plaintext while EPP_PORT is TLS.
  const resolved: EppServerOptions = {
    host: options?.host ?? config.eppHost,
    port: options?.port ?? config.eppPort,
    label: options?.label ?? "EPP testing tool",
    exitOnError: options?.exitOnError ?? true,
    tls: options?.tls ?? isTlsEnabled(config)
  };

  // TEMPORARY DEBUG counter — reset on process restart. Remove with TEMP_DEBUG_TLS_ACCEPT_LIMIT.
  let tlsConnectionsSeen = 0;

  const onConnection = (socket: net.Socket): void => {
    const sessionId = randomUUID();
    const presented = peerCertificateFingerprint(socket);

    if (resolved.tls) {
      logClientCertificateChain(socket as tls.TLSSocket, {
        label: resolved.label,
        sessionId,
        remote: formatRemote(socket)
      });

      // TEMPORARY DEBUG: only enforce on the production listener (exitOnError default true).
      // Loopback is ignored so local health checks do not consume the budget.
      if (resolved.exitOnError && !isLoopbackRemote(socket)) {
        tlsConnectionsSeen += 1;
        const connectionNumber = tlsConnectionsSeen;

        if (connectionNumber > TEMP_DEBUG_TLS_ACCEPT_LIMIT) {
          console.log(
            `${resolved.label} TEMPORARY DEBUG rejecting TLS connection ${connectionNumber}` +
              ` session=${sessionId} remote=${formatRemote(socket)}` +
              ` (accept limit ${TEMP_DEBUG_TLS_ACCEPT_LIMIT})`
          );
          socket.destroy();
          return;
        }

        console.log(
          `${resolved.label} TEMPORARY DEBUG accepting TLS connection ${connectionNumber}/${TEMP_DEBUG_TLS_ACCEPT_LIMIT}` +
            ` session=${sessionId} remote=${formatRemote(socket)}`
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
    ? tls.createServer(
        {
          cert: readFileSync(config.eppTlsCertPath as string),
          key: readFileSync(config.eppTlsKeyPath as string),
          ca: config.eppTlsCaPath ? readFileSync(config.eppTlsCaPath) : undefined,
          requestCert: config.eppTlsRequireClientCert,
          rejectUnauthorized: false,
          minVersion: "TLSv1.2",
          maxVersion: "TLSv1.3",
          honorCipherOrder: true,
          ciphers: RFC_9325_TLS12_CIPHERS
        },
        onConnection
      )
    : net.createServer(onConnection);

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
    if (resolved.tls && resolved.exitOnError) {
      console.log(
        `${resolved.label} TEMPORARY DEBUG accepting only the first ${TEMP_DEBUG_TLS_ACCEPT_LIMIT} TLS connections`
      );
    }
  });

  return server;
}

function peerCertificateFingerprint(socket: net.Socket): string | undefined {
  const chain = collectPeerCertificateChain(socket);
  return chain[0]?.fingerprint256;
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
  meta: { label: string; sessionId: string; remote: string }
): void {
  const chain = collectPeerCertificateChain(socket);
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
