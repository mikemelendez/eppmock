import {
  DomainAlreadyExistsError,
  DomainNotFoundOrUnauthorizedError,
  DomainService,
  RegistryPolicyError
} from "../domain/domainService.js";
import {
  domainCheckResponse,
  domainCreateResponse,
  domainInfoResponse,
  domainLaunchCheckResponse,
  domainLaunchCreateResponse,
  domainRenewResponse,
  domainRestoreResponse,
  domainTransferResponse,
  objectDoesNotExist,
  objectExists,
  objectNotAuthorized,
  parameterValuePolicyError
} from "./domainResponses.js";
import { childNode, childValue, getCommand, node, stringValues, text } from "./commandExtractor.js";
import type { PollMessageRepository } from "./pollMessageRepository.js";
import { commandCompleted, syntaxError } from "./responses.js";
import type { CommandContext, CommandHandler } from "./types.js";
import { asArray } from "./xml.js";

const LAUNCH_NS = "urn:ietf:params:xml:ns:launch-1.0";
const RGP_NS = "urn:ietf:params:xml:ns:rgp-1.0";

export class DomainCommandHandler implements CommandHandler {
  constructor(
    private readonly domains: DomainService,
    private readonly pollMessages?: PollMessageRepository
  ) {}

  async handle(document: Record<string, unknown>, context: CommandContext): Promise<string> {
    const command = getCommand(document);

    if (!command) {
      return syntaxError(context.transactionId);
    }

    if ("check" in command) {
      return this.check(command.check, context, node(command.extension));
    }

    if ("create" in command) {
      return this.create(command.create, context, node(command.extension));
    }

    if ("info" in command) {
      return this.info(command.info, context);
    }

    if ("delete" in command) {
      return this.delete(command.delete, context);
    }

    if ("update" in command) {
      return this.update(command.update, context, node(command.extension));
    }

    if ("renew" in command) {
      return this.renew(command.renew, context);
    }

    if ("transfer" in command) {
      return this.transfer(command.transfer, context);
    }

    return syntaxError(context.transactionId);
  }

  private async check(value: unknown, context: CommandContext, extension?: Record<string, unknown>): Promise<string> {
    const domainCheck = childNode(value, "check");
    const names = stringValues(childValue(domainCheck, "name"));

    if (names.length === 0) {
      return syntaxError(context.transactionId);
    }

    try {
      const results = await this.domains.checkAvailability(names);

      const launchCheck = namespacedNode(extension, LAUNCH_NS, "check");

      if (launchCheck) {
        const phase = text(namespacedValue(launchCheck, LAUNCH_NS, "phase")) ?? "claims";
        return domainLaunchCheckResponse(
          names.map((name) => ({
            name,
            claimKey: name.toLowerCase().includes("claim") ? `claim-key-${name}` : undefined
          })),
          phase,
          context.transactionId
        );
      }

      return domainCheckResponse(results, context.transactionId);
    } catch (error) {
      if (error instanceof RegistryPolicyError) {
        return parameterValuePolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async create(
    value: unknown,
    context: CommandContext,
    extension?: Record<string, unknown>
  ): Promise<string> {
    const domainCreate = childNode(value, "create");
    const name = text(childValue(domainCreate, "name"));
    const period = parsePeriod(childValue(domainCreate, "period"));
    const nameservers = parseNameservers(childValue(domainCreate, "ns"));
    const registrantContact = text(childValue(domainCreate, "registrant"));
    const contacts = parseContacts(childValue(domainCreate, "contact"));
    const authInfo = parseAuthInfo(childValue(domainCreate, "authInfo"));
    const dsRecords = parseDsRecords(extension);

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
        authInfo,
        dsRecords
      });

      const launchCreate = namespacedNode(extension, LAUNCH_NS, "create");

      if (launchCreate) {
        const phase = text(namespacedValue(launchCreate, LAUNCH_NS, "phase")) ?? "sunrise";
        const applicationId = `${domain.name}-${Date.now()}`;
        return domainLaunchCreateResponse(domain.name, phase, applicationId, context.transactionId);
      }

      return domainCreateResponse(domain, context.transactionId);
    } catch (error) {
      if (error instanceof DomainAlreadyExistsError) {
        return objectExists(context.transactionId);
      }

      if (error instanceof RegistryPolicyError) {
        return parameterValuePolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async update(
    value: unknown,
    context: CommandContext,
    extension?: Record<string, unknown>
  ): Promise<string> {
    const domainUpdate = childNode(value, "update");
    const name = text(childValue(domainUpdate, "name"));

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    const rgpRestore = namespacedNode(namespacedNode(extension, RGP_NS, "update"), RGP_NS, "restore");

    if (rgpRestore) {
      try {
        const restored = await this.domains.restore(name, context.session.clid);
        return domainRestoreResponse(restored, context.transactionId);
      } catch (error) {
        if (error instanceof DomainNotFoundOrUnauthorizedError) {
          return objectNotAuthorized(context.transactionId);
        }

        if (error instanceof RegistryPolicyError) {
          return parameterValuePolicyError(context.transactionId);
        }

        throw error;
      }
    }

    try {
      await this.domains.update(name, context.session.clid, {
        nameserversToAdd: parseNameservers(childValue(childNode(domainUpdate, "add"), "ns")),
        nameserversToRemove: parseNameservers(childValue(childNode(domainUpdate, "rem"), "ns")),
        contactsToAdd: parseContacts(childValue(childNode(domainUpdate, "add"), "contact")),
        contactsToRemove: parseContacts(childValue(childNode(domainUpdate, "rem"), "contact")),
        statusesToAdd: parseStatuses(childValue(childNode(domainUpdate, "add"), "status")),
        statusesToRemove: parseStatuses(childValue(childNode(domainUpdate, "rem"), "status")),
        registrantContact: text(childValue(childNode(domainUpdate, "chg"), "registrant")),
        authInfo: parseAuthInfo(childValue(childNode(domainUpdate, "chg"), "authInfo")),
        dsRecordsToAdd: parseDsRecords(extension),
        dsRecordsToRemove: parseDsRecords(extension, "rem")
      });

      return commandCompleted(context.transactionId);
    } catch (error) {
      if (error instanceof DomainNotFoundOrUnauthorizedError) {
        return objectNotAuthorized(context.transactionId);
      }

      if (error instanceof RegistryPolicyError) {
        return parameterValuePolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async info(value: unknown, context: CommandContext): Promise<string> {
    const domainInfo = childNode(value, "info");
    const name = text(childValue(domainInfo, "name"));

    if (!name) {
      return syntaxError(context.transactionId);
    }

    let domain;

    try {
      domain = await this.domains.findByName(name);
    } catch (error) {
      if (error instanceof RegistryPolicyError) {
        return parameterValuePolicyError(context.transactionId);
      }

      throw error;
    }

    if (!domain) {
      return objectDoesNotExist(context.transactionId);
    }

    return domainInfoResponse(domain, context.transactionId);
  }

  private async delete(value: unknown, context: CommandContext): Promise<string> {
    const domainDelete = childNode(value, "delete");
    const name = text(childValue(domainDelete, "name"));

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      await this.domains.deleteWithGrace(name, context.session.clid);
      return commandCompleted(context.transactionId);
    } catch (error) {
      if (error instanceof DomainNotFoundOrUnauthorizedError) {
        return objectNotAuthorized(context.transactionId);
      }

      if (error instanceof RegistryPolicyError) {
        return parameterValuePolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async renew(value: unknown, context: CommandContext): Promise<string> {
    const domainRenew = childNode(value, "renew");
    const name = text(childValue(domainRenew, "name"));
    const period = parsePeriod(childValue(domainRenew, "period"));

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

      if (error instanceof RegistryPolicyError) {
        return parameterValuePolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async transfer(value: unknown, context: CommandContext): Promise<string> {
    const transferNode = node(value);
    const operation = transferOperation(transferNode?.["@_op"]);
    const domainTransfer = childNode(transferNode, "transfer");
    const name = text(childValue(domainTransfer, "name"));

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      const domain = await this.domains.transfer(name, operation, context.session.clid);

      if (operation === "request" && this.pollMessages) {
        this.pollMessages.enqueue({
          registrarId: domain.registrarId,
          text: `Transfer requested for ${domain.name}`,
          resData: {
            "domain:trnData": {
              "@_xmlns:domain": "urn:ietf:params:xml:ns:domain-1.0",
              "domain:name": domain.name,
              "domain:trStatus": domain.transfer?.status ?? "pending"
            }
          }
        });
      }

      return domainTransferResponse(domain, context.transactionId);
    } catch (error) {
      if (error instanceof DomainNotFoundOrUnauthorizedError) {
        return objectDoesNotExist(context.transactionId);
      }

      if (error instanceof RegistryPolicyError) {
        return parameterValuePolicyError(context.transactionId);
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
  return stringValues(childValue(ns, "hostObj"));
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
  return text(childValue(value, "pw"));
}

function parseDsRecords(value: unknown, section: "add" | "rem" = "add"): Array<{
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: string;
}> {
  const root = node(value);
  const secDnsCreate = prefixedNode(root, "create");
  const secDnsUpdate = prefixedNode(root, "update");
  const dsContainer =
    secDnsCreate ?? (section === "add" ? prefixedNode(secDnsUpdate, "add") : prefixedNode(secDnsUpdate, "rem")) ?? root;

  return asArray(prefixedValue(dsContainer, "dsData")).flatMap((entry) => {
    const dsData = node(entry);
    const keyTag = Number(text(prefixedValue(dsData, "keyTag")));
    const algorithm = Number(text(prefixedValue(dsData, "alg")));
    const digestType = Number(text(prefixedValue(dsData, "digestType")));
    const digest = text(prefixedValue(dsData, "digest"));

    if (
      !Number.isInteger(keyTag) ||
      !Number.isInteger(algorithm) ||
      !Number.isInteger(digestType) ||
      !digest
    ) {
      return [];
    }

    return [
      {
        keyTag,
        algorithm,
        digestType,
        digest: digest.toUpperCase()
      }
    ];
  });
}

function namespacedNode(
  value: Record<string, unknown> | undefined,
  namespaceUri: string,
  localName: string
): Record<string, unknown> | undefined {
  return node(namespacedValue(value, namespaceUri, localName));
}

/**
 * Finds a child whose element belongs to a specific XML namespace, disambiguating prefixes
 * that share a local name (e.g. secDNS:create vs launch:create).
 */
function namespacedValue(
  value: Record<string, unknown> | undefined,
  namespaceUri: string,
  localName: string
): unknown {
  if (!value) {
    return undefined;
  }

  const prefixes = namespacePrefixes(value, namespaceUri);
  const keys = Object.keys(value);

  for (const key of keys) {
    const [prefix, local] = key.includes(":") ? key.split(":") : ["", key];

    if (local !== localName) {
      continue;
    }

    if (prefixes.length === 0 || prefixes.includes(prefix) || prefix === "") {
      return value[key];
    }
  }

  return undefined;
}

function namespacePrefixes(value: Record<string, unknown>, namespaceUri: string): string[] {
  const prefixes: string[] = [];

  for (const [key, attrValue] of Object.entries(value)) {
    if (key.startsWith("@_xmlns:") && attrValue === namespaceUri) {
      prefixes.push(key.slice("@_xmlns:".length));
    }
  }

  return prefixes;
}

function prefixedNode(value: Record<string, unknown> | undefined, localName: string): Record<string, unknown> | undefined {
  return node(prefixedValue(value, localName));
}

function prefixedValue(value: Record<string, unknown> | undefined, localName: string): unknown {
  const key = Object.keys(value ?? {}).find((entry) => entry === localName || entry.endsWith(`:${localName}`));
  return key ? value?.[key] : undefined;
}

function transferOperation(value: unknown): "request" | "approve" | "reject" | "cancel" | "query" {
  if (value === "request" || value === "approve" || value === "reject" || value === "cancel" || value === "query") {
    return value;
  }

  return "query";
}
