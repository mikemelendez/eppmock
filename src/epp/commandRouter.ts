import { randomUUID } from "node:crypto";
import { AuthCommandHandler } from "./authCommandHandler.js";
import { extractCommand } from "./commandExtractor.js";
import { CommandLogRepository } from "./commandLogRepository.js";
import { authorizationError, unknownCommand } from "./responses.js";
import type { CommandContext, CommandHandler, EppSession } from "./types.js";
import { parseEppXml } from "./xml.js";

export class CommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor(
    authHandler: AuthCommandHandler,
    private readonly commandLog: CommandLogRepository
  ) {
    this.handlers.set("login", authHandler);
    this.handlers.set("logout", authHandler);
  }

  register(commandName: string, handler: CommandHandler): void {
    this.handlers.set(commandName, handler);
  }

  async route(rawXml: string, session: EppSession): Promise<string> {
    const document = parseEppXml(rawXml);
    const command = extractCommand(document);
    const context: CommandContext = {
      session,
      rawXml,
      transactionId: command.transactionId
    };

    const handler = this.handlers.get(command.name);
    let responseXml: string;

    if (!handler) {
      responseXml = unknownCommand(command.transactionId);
    } else if (!session.authenticated && command.name !== "login" && command.name !== "hello") {
      responseXml = authorizationError(command.transactionId);
    } else {
      responseXml = await handler.handle(document, context);
    }

    this.commandLog.append({
      id: randomUUID(),
      sessionId: session.id,
      clid: session.clid,
      commandName: command.name,
      requestXml: rawXml,
      responseXml,
      createdAt: new Date().toISOString()
    });

    return responseXml;
  }
}
