import type { AppConfig } from "../config.js";
import { childValue, getCommand, node, stringValues, text } from "./commandExtractor.js";
import { supportedObjectUris } from "./responses.js";
import {
  authenticationError,
  commandCompleted,
  syntaxError,
  unimplementedObjectService,
  unimplementedOption,
  unimplementedProtocolVersion
} from "./responses.js";
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

    const options = node(login?.options);
    const version = text(options?.version);
    const lang = text(options?.lang);

    // The XML parser may coerce "1.0" to the number 1, so accept both forms.
    if (version !== undefined && version !== "1.0" && version !== "1") {
      return unimplementedProtocolVersion(context.transactionId);
    }

    if (lang !== undefined && lang !== "en") {
      return unimplementedOption(context.transactionId);
    }

    const requestedObjects = stringValues(childValue(node(login?.svcs), "objURI"));
    const unsupportedObject = requestedObjects.find((uri) => !supportedObjectUris.includes(uri));

    if (unsupportedObject) {
      return unimplementedObjectService(context.transactionId);
    }

    const user = this.config.authUsers.find((authUser) => authUser.clid === clid);

    if (!user || password !== user.password) {
      return authenticationError(context.transactionId);
    }

    context.session.authenticated = true;
    context.session.clid = clid;
    return commandCompleted(context.transactionId);
  }
}
