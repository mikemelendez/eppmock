import type { AppConfig } from "../config.js";
import { hasChild, node } from "./commandExtractor.js";
import type { PollMessageRepository } from "./pollMessageRepository.js";
import {
  greeting,
  pollAckResponse,
  pollMessageResponse,
  pollNoMessages,
  resultResponse
} from "./responses.js";
import type { CommandContext, CommandHandler } from "./types.js";

export class SystemCommandHandler implements CommandHandler {
  constructor(
    private readonly config: Pick<AppConfig, "greetingServerId">,
    private readonly pollMessages?: PollMessageRepository
  ) {}

  async handle(document: Record<string, unknown>, context: CommandContext): Promise<string> {
    const epp = node(document.epp);

    if (epp && (hasChild(epp, "hello") || hasChild(node(epp.command), "hello"))) {
      return greeting(this.config.greetingServerId);
    }

    const poll = node(node(epp?.command)?.poll);
    const operation = typeof poll?.["@_op"] === "string" ? poll["@_op"] : "req";
    const registrarId = context.session.clid;

    if (!this.pollMessages || !registrarId) {
      if (operation === "ack") {
        return resultResponse(1000, "Command completed successfully", context.transactionId);
      }

      return pollNoMessages(context.transactionId);
    }

    if (operation === "ack") {
      const messageId = typeof poll?.["@_msgID"] === "string" ? poll["@_msgID"] : "";
      const { acked, remaining } = this.pollMessages.ack(registrarId, messageId);

      if (!acked) {
        return pollNoMessages(context.transactionId);
      }

      return pollAckResponse(messageId, remaining, context.transactionId);
    }

    const message = this.pollMessages.peek(registrarId);

    if (!message) {
      return pollNoMessages(context.transactionId);
    }

    return pollMessageResponse(
      {
        id: message.id,
        enqueuedAt: message.enqueuedAt,
        text: message.text,
        remaining: this.pollMessages.count(registrarId),
        resData: message.resData
      },
      context.transactionId
    );
  }
}
