import { randomUUID } from "node:crypto";
import net from "node:net";
import type { AppConfig } from "../config.js";
import { EppFrameDecoder, encodeFrame } from "./framing.js";
import { greeting, resultResponse } from "./responses.js";
import type { CommandRouter } from "./commandRouter.js";
import type { EppSession } from "./types.js";

export function startEppServer(config: AppConfig, router: CommandRouter): net.Server {
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
      console.error("EPP socket error", error);
    });
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    const hint =
      error.code === "EADDRINUSE"
        ? ` (port ${config.eppPort} is already in use; on macOS the AirPlay Receiver and Control Center listen on 7000 \u2014 disable it or set EPP_PORT)`
        : "";
    console.error(
      `EPP server failed to start on ${config.eppHost}:${config.eppPort}${hint}:`,
      error.message
    );
    process.exitCode = 1;
  });

  server.listen(config.eppPort, config.eppHost, () => {
    console.log(`EPP testing tool listening on ${config.eppHost}:${config.eppPort}`);
  });

  return server;
}

async function handleChunk(
  chunk: Buffer,
  decoder: EppFrameDecoder,
  session: EppSession,
  socket: net.Socket,
  router: CommandRouter
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
