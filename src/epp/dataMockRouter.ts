import { extractCommand } from "./commandExtractor.js";
import type { DataMockHandler } from "./dataMockHandler.js";
import type { EppRouter } from "./eppServer.js";
import type { CommandContext, EppSession } from "./types.js";
import { parseEppXml } from "./xml.js";

/**
 * Stateless router for data-based mock mode. It performs no authentication or session gating:
 * every command is answered purely from its request data via the DataMockHandler.
 */
export class DataMockRouter implements EppRouter {
  constructor(private readonly handler: DataMockHandler) {}

  async route(rawXml: string, session: EppSession): Promise<string> {
    const document = parseEppXml(rawXml);
    const command = extractCommand(document);
    const context: CommandContext = {
      session,
      rawXml,
      transactionId: command.transactionId
    };

    return this.handler.respond(command.name, document, context);
  }
}
