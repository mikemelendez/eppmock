import { randomUUID } from "node:crypto";
import net from "node:net";
import type { AppConfig } from "../config.js";
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
}

export function startEppServer(config: AppConfig, router: EppRouter, options?: Partial<EppServerOptions>): net.Server {
  const resolved: EppServerOptions = {
    host: options?.host ?? config.eppHost,
    port: options?.port ?? config.eppPort,
    label: options?.label ?? "EPP testing tool",
    exitOnError: options?.exitOnError ?? true
  };

  const server = net.createServer((socket) => {
    const decoder = new EppFrameDecoder();
    const session: EppSession = {
      id: randomUUID(),
      authenticated: false,
      connectedAt: new Date(),
      lastCommandAt: new Date()
    };

    socket.write(encodeFrame(greeting(config.greetingServerId)));

    socket.on("data", (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      void handleChunk(buffer, decoder, session, socket, router);
    });

    socket.on("error", (error) => {
      console.error(`${resolved.label} socket error`, error);
    });
  });

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
    console.log(`${resolved.label} listening on ${resolved.host}:${resolved.port}`);
  });

  return server;
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
