import {
  ContactAlreadyExistsError,
  ContactNotFoundOrUnauthorizedError,
  ContactService,
  ContactValidationError
} from "../contact/contactService.js";
import type { ContactPostalInfo } from "../contact/types.js";
import { childNode, childValue, getCommand, node, stringValues, text } from "./commandExtractor.js";
import {
  contactCheckResponse,
  contactCreateResponse,
  contactInfoResponse,
  contactNotAuthorized,
  contactObjectDoesNotExist,
  contactObjectExists
} from "./contactResponses.js";
import { commandCompleted, syntaxError } from "./responses.js";
import type { CommandContext, CommandHandler } from "./types.js";
import { asArray } from "./xml.js";

export class ContactCommandHandler implements CommandHandler {
  constructor(private readonly contacts: ContactService) {}

  async handle(document: Record<string, unknown>, context: CommandContext): Promise<string> {
    const command = getCommand(document);

    if (!command) {
      return syntaxError(context.transactionId);
    }

    if ("check" in command) {
      return this.check(command.check, context);
    }

    if ("create" in command) {
      return this.create(command.create, context);
    }

    if ("info" in command) {
      return this.info(command.info, context);
    }

    if ("update" in command) {
      return this.update(command.update, context);
    }

    if ("delete" in command) {
      return this.delete(command.delete, context);
    }

    return syntaxError(context.transactionId);
  }

  private async check(value: unknown, context: CommandContext): Promise<string> {
    const ids = stringValues(childValue(childNode(value, "check"), "id"));

    if (ids.length === 0) {
      return syntaxError(context.transactionId);
    }

    const results = await this.contacts.checkAvailability(ids);
    return contactCheckResponse(results, context.transactionId);
  }

  private async create(value: unknown, context: CommandContext): Promise<string> {
    const contactCreate = childNode(value, "create");
    const id = text(childValue(contactCreate, "id"));
    const email = text(childValue(contactCreate, "email"));
    const postalInfo = parsePostalInfo(childValue(contactCreate, "postalInfo"));

    if (!id || !email || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      const contact = await this.contacts.create({
        id,
        registrarId: context.session.clid,
        email,
        postalInfo,
        voice: text(childValue(contactCreate, "voice")),
        fax: text(childValue(contactCreate, "fax")),
        authInfo: text(childValue(childNode(contactCreate, "authInfo"), "pw"))
      });

      return contactCreateResponse(contact, context.transactionId);
    } catch (error) {
      if (error instanceof ContactAlreadyExistsError) {
        return contactObjectExists(context.transactionId);
      }

      if (error instanceof ContactValidationError) {
        return syntaxError(context.transactionId);
      }

      throw error;
    }
  }

  private async info(value: unknown, context: CommandContext): Promise<string> {
    const id = text(childValue(childNode(value, "info"), "id"));

    if (!id) {
      return syntaxError(context.transactionId);
    }

    const contact = await this.contacts.findById(id);

    if (!contact) {
      return contactObjectDoesNotExist(context.transactionId);
    }

    return contactInfoResponse(contact, context.transactionId);
  }

  private async update(value: unknown, context: CommandContext): Promise<string> {
    const contactUpdate = childNode(value, "update");
    const id = text(childValue(contactUpdate, "id"));

    if (!id || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    const change = childNode(contactUpdate, "chg");

    try {
      await this.contacts.update(id, context.session.clid, {
        statusesToAdd: parseStatuses(childValue(childNode(contactUpdate, "add"), "status")),
        statusesToRemove: parseStatuses(childValue(childNode(contactUpdate, "rem"), "status")),
        postalInfo: change ? parsePostalInfo(childValue(change, "postalInfo")) : undefined,
        voice: text(childValue(change, "voice")),
        fax: text(childValue(change, "fax")),
        email: text(childValue(change, "email")),
        authInfo: text(childValue(childNode(change, "authInfo"), "pw"))
      });

      return commandCompleted(context.transactionId);
    } catch (error) {
      if (error instanceof ContactNotFoundOrUnauthorizedError) {
        return contactNotAuthorized(context.transactionId);
      }

      throw error;
    }
  }

  private async delete(value: unknown, context: CommandContext): Promise<string> {
    const id = text(childValue(childNode(value, "delete"), "id"));

    if (!id || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      await this.contacts.delete(id, context.session.clid);
      return commandCompleted(context.transactionId);
    } catch (error) {
      if (error instanceof ContactNotFoundOrUnauthorizedError) {
        return contactNotAuthorized(context.transactionId);
      }

      throw error;
    }
  }
}

function parsePostalInfo(value: unknown): ContactPostalInfo[] {
  return asArray(value).flatMap((entry) => {
    const postal = node(entry);

    if (!postal) {
      return [];
    }

    const type = postal["@_type"] === "loc" ? "loc" : "int";
    const name = text(childValue(postal, "name"));
    const addr = childNode(postal, "addr");
    const city = text(childValue(addr, "city"));
    const cc = text(childValue(addr, "cc"));

    if (!name || !city || !cc) {
      return [];
    }

    return [
      {
        type,
        name,
        org: text(childValue(postal, "org")),
        street: stringValues(childValue(addr, "street")),
        city,
        sp: text(childValue(addr, "sp")),
        pc: text(childValue(addr, "pc")),
        cc
      }
    ];
  });
}

function parseStatuses(value: unknown): string[] {
  return asArray(value).flatMap((entry) => {
    const status = node(entry)?.["@_s"];
    return typeof status === "string" ? [status] : [];
  });
}
