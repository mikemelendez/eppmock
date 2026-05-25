import type { AppConfig } from "../config.js";
import { hasChild, node } from "./commandExtractor.js";
import { greeting, resultResponse } from "./responses.js";
import type { CommandContext, CommandHandler } from "./types.js";

export class SystemCommandHandler implements CommandHandler {
  constructor(private readonly config: Pick<AppConfig, "greetingServerId">) {}

  async handle(document: Record<string, unknown>, context: CommandContext): Promise<string> {
    const epp = node(document.epp);

    if (epp && (hasChild(epp, "hello") || hasChild(node(epp.command), "hello"))) {
      return greeting(this.config.greetingServerId);
    }

    const poll = node(node(epp?.command)?.poll);
    const operation = typeof poll?.["@_op"] === "string" ? poll["@_op"] : "req";

    if (operation === "ack") {
      return resultResponse(1000, "Command completed successfully", context.transactionId);
    }

    return resultResponse(1300, "Command completed successfully; no messages", context.transactionId);
  }
}
