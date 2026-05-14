import {
  DomainAlreadyExistsError,
  DomainNotFoundOrUnauthorizedError,
  DomainService
} from "../domain/domainService.js";
import {
  domainCheckResponse,
  domainCreateResponse,
  domainInfoResponse,
  domainRenewResponse,
  domainTransferResponse,
  objectDoesNotExist,
  objectExists,
  objectNotAuthorized
} from "./domainResponses.js";
import { getCommand, node, stringValues, text } from "./commandExtractor.js";
import { commandCompleted, syntaxError } from "./responses.js";
import type { CommandContext, CommandHandler } from "./types.js";
import { asArray } from "./xml.js";

export class DomainCommandHandler implements CommandHandler {
  constructor(private readonly domains: DomainService) {}

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

    if ("delete" in command) {
      return this.delete(command.delete, context);
    }

    if ("update" in command) {
      return this.update(command.update, context);
    }

    if ("renew" in command) {
      return this.renew(command.renew, context);
    }

    if ("transfer" in command) {
      return this.transfer(command.transfer, context);
    }

    return syntaxError(context.transactionId);
  }

  private async check(value: unknown, context: CommandContext): Promise<string> {
    const domainCheck = node(node(value)?.["domain:check"]);
    const names = stringValues(domainCheck?.["domain:name"]);

    if (names.length === 0) {
      return syntaxError(context.transactionId);
    }

    const results = await this.domains.checkAvailability(names);
    return domainCheckResponse(results, context.transactionId);
  }

  private async create(value: unknown, context: CommandContext): Promise<string> {
    const domainCreate = node(node(value)?.["domain:create"]);
    const name = text(domainCreate?.["domain:name"]);
    const period = parsePeriod(domainCreate?.["domain:period"]);
    const nameservers = parseNameservers(domainCreate?.["domain:ns"]);
    const registrantContact = text(domainCreate?.["domain:registrant"]);
    const contacts = parseContacts(domainCreate?.["domain:contact"]);
    const authInfo = parseAuthInfo(domainCreate?.["domain:authInfo"]);

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      const domain = await this.domains.create({
        name,
        registrarId: context.session.clid,
        periodYears: period,
        nameservers,
        registrantContact,
        contacts,
        authInfo
      });

      return domainCreateResponse(domain, context.transactionId);
    } catch (error) {
      if (error instanceof DomainAlreadyExistsError) {
        return objectExists(context.transactionId);
      }

      throw error;
    }
  }

  private async update(value: unknown, context: CommandContext): Promise<string> {
    const domainUpdate = node(node(value)?.["domain:update"]);
    const name = text(domainUpdate?.["domain:name"]);

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      await this.domains.update(name, context.session.clid, {
        nameserversToAdd: parseNameservers(node(domainUpdate?.["domain:add"])?.["domain:ns"]),
        nameserversToRemove: parseNameservers(node(domainUpdate?.["domain:rem"])?.["domain:ns"]),
        contactsToAdd: parseContacts(node(domainUpdate?.["domain:add"])?.["domain:contact"]),
        contactsToRemove: parseContacts(node(domainUpdate?.["domain:rem"])?.["domain:contact"]),
        statusesToAdd: parseStatuses(node(domainUpdate?.["domain:add"])?.["domain:status"]),
        statusesToRemove: parseStatuses(node(domainUpdate?.["domain:rem"])?.["domain:status"]),
        registrantContact: text(node(domainUpdate?.["domain:chg"])?.["domain:registrant"]),
        authInfo: parseAuthInfo(node(domainUpdate?.["domain:chg"])?.["domain:authInfo"])
      });

      return commandCompleted(context.transactionId);
    } catch (error) {
      if (error instanceof DomainNotFoundOrUnauthorizedError) {
        return objectNotAuthorized(context.transactionId);
      }

      throw error;
    }
  }

  private async info(value: unknown, context: CommandContext): Promise<string> {
    const domainInfo = node(node(value)?.["domain:info"]);
    const name = text(domainInfo?.["domain:name"]);

    if (!name) {
      return syntaxError(context.transactionId);
    }

    const domain = await this.domains.findByName(name);

    if (!domain) {
      return objectDoesNotExist(context.transactionId);
    }

    return domainInfoResponse(domain, context.transactionId);
  }

  private async delete(value: unknown, context: CommandContext): Promise<string> {
    const domainDelete = node(node(value)?.["domain:delete"]);
    const name = text(domainDelete?.["domain:name"]);

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      await this.domains.delete(name, context.session.clid);
      return commandCompleted(context.transactionId);
    } catch (error) {
      if (error instanceof DomainNotFoundOrUnauthorizedError) {
        return objectNotAuthorized(context.transactionId);
      }

      throw error;
    }
  }

  private async renew(value: unknown, context: CommandContext): Promise<string> {
    const domainRenew = node(node(value)?.["domain:renew"]);
    const name = text(domainRenew?.["domain:name"]);
    const period = parsePeriod(domainRenew?.["domain:period"]);

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      const domain = await this.domains.renew(name, context.session.clid, period);
      return domainRenewResponse(domain, context.transactionId);
    } catch (error) {
      if (error instanceof DomainNotFoundOrUnauthorizedError) {
        return objectNotAuthorized(context.transactionId);
      }

      throw error;
    }
  }

  private async transfer(value: unknown, context: CommandContext): Promise<string> {
    const transferNode = node(value);
    const operation = transferOperation(transferNode?.["@_op"]);
    const domainTransfer = node(transferNode?.["domain:transfer"]);
    const name = text(domainTransfer?.["domain:name"]);

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      const domain = await this.domains.transfer(name, operation, context.session.clid);
      return domainTransferResponse(domain, context.transactionId);
    } catch (error) {
      if (error instanceof DomainNotFoundOrUnauthorizedError) {
        return objectDoesNotExist(context.transactionId);
      }

      throw error;
    }
  }
}

function parsePeriod(value: unknown): number | undefined {
  const [periodNode] = asArray(value);
  const periodText = text(periodNode);
  const unit = node(periodNode)?.["@_unit"];

  if (!periodText || unit !== "y") {
    return undefined;
  }

  const period = Number(periodText);
  return Number.isInteger(period) && period > 0 ? period : undefined;
}

function parseNameservers(value: unknown): string[] {
  const ns = node(value);
  return stringValues(ns?.["domain:hostObj"]);
}

function parseContacts(value: unknown): Array<{ type: "admin" | "tech" | "billing"; id: string }> {
  return asArray(value).flatMap((entry) => {
    const contactType = node(entry)?.["@_type"];
    const id = text(entry);

    if (!id || (contactType !== "admin" && contactType !== "tech" && contactType !== "billing")) {
      return [];
    }

    return [{ type: contactType, id }];
  });
}

function parseStatuses(value: unknown): string[] {
  return asArray(value).flatMap((entry) => {
    const status = node(entry)?.["@_s"];
    return typeof status === "string" ? [status] : [];
  });
}

function parseAuthInfo(value: unknown): string | undefined {
  return text(node(value)?.["domain:pw"]);
}

function transferOperation(value: unknown): "request" | "approve" | "reject" | "cancel" | "query" {
  if (value === "request" || value === "approve" || value === "reject" || value === "cancel" || value === "query") {
    return value;
  }

  return "query";
}
