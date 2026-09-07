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
 * Anything that can turn a raw EPP frame into a response frame. Both the database-backed
 * CommandRouter and the stateless DataMockRouter satisfy this contract.
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

export function startEppServer(config: AppConfig, router: EppRouter, options?: Partial<EppServerOptions>): net.Server {
  const resolved: EppServerOptions = {
    host: options?.host ?? config.eppHost,
    port: options?.port ?? config.eppPort,
    label: options?.label ?? "EPP testing tool",
    exitOnError: options?.exitOnError ?? true,
    tls: options?.tls ?? isTlsEnabled(config)
  };

  const onConnection = (socket: net.Socket): void => {
    const decoder = new EppFrameDecoder();
    const session: EppSession = {
      id: randomUUID(),
      authenticated: false,
      tls: resolved.tls,
      connectedAt: new Date(),
      lastCommandAt: new Date(),
      clientCertSha256: peerCertificateFingerprint(socket)
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
  });

  return server;
}

function peerCertificateFingerprint(socket: net.Socket): string | undefined {
  if (!("getPeerCertificate" in socket) || typeof socket.getPeerCertificate !== "function") {
    return undefined;
  }

  const certificate = (socket as tls.TLSSocket).getPeerCertificate();

  if (!certificate || !("fingerprint256" in certificate) || !certificate.fingerprint256) {
    return undefined;
  }

  return String(certificate.fingerprint256).replaceAll(":", "").toLowerCase();
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
