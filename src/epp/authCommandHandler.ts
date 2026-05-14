import type { AppConfig } from "../config.js";
import { getCommand, node, text } from "./commandExtractor.js";
import { authenticationError, commandCompleted, syntaxError } from "./responses.js";
import type { CommandContext, CommandHandler } from "./types.js";

export class AuthCommandHandler implements CommandHandler {
  constructor(private readonly config: Pick<AppConfig, "authUsers">) {}

  async handle(document: Record<string, unknown>, context: CommandContext): Promise<string> {
    const command = getCommand(document);

    if (!command) {
      return syntaxError(context.transactionId);
    }

    if ("login" in command) {
      return this.login(command.login, context);
    }

    if ("logout" in command) {
      context.session.authenticated = false;
      return commandCompleted(context.transactionId);
    }

    return syntaxError(context.transactionId);
  }

  private login(value: unknown, context: CommandContext): string {
    const login = node(value);
    const clid = text(login?.clID);
    const password = text(login?.pw);
    const user = this.config.authUsers.find((authUser) => authUser.clid === clid);

    if (!user || password !== user.password) {
      return authenticationError(context.transactionId);
    }

    context.session.authenticated = true;
    context.session.clid = clid;
    return commandCompleted(context.transactionId);
  }
}
