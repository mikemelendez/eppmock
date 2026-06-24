import { isIP } from "node:net";
import {
  HostAlreadyExistsError,
  HostNotFoundOrUnauthorizedError,
  HostService,
  HostValidationError
} from "../host/hostService.js";
import type { HostAddress } from "../host/types.js";
import { childNode, childValue, getCommand, node, stringValues, text } from "./commandExtractor.js";
import {
  hostCheckResponse,
  hostCreateResponse,
  hostInfoResponse,
  hostNotAuthorized,
  hostObjectDoesNotExist,
  hostObjectExists,
  hostParameterPolicyError
} from "./hostResponses.js";
import { commandCompleted, syntaxError } from "./responses.js";
import type { CommandContext, CommandHandler } from "./types.js";
import { asArray } from "./xml.js";

export class HostCommandHandler implements CommandHandler {
  constructor(private readonly hosts: HostService) {}

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
    const names = stringValues(childValue(childNode(value, "check"), "name"));

    if (names.length === 0) {
      return syntaxError(context.transactionId);
    }

    try {
      const results = await this.hosts.checkAvailability(names);
      return hostCheckResponse(results, context.transactionId);
    } catch (error) {
      if (error instanceof HostValidationError) {
        return hostParameterPolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async create(value: unknown, context: CommandContext): Promise<string> {
    const hostCreate = childNode(value, "create");
    const name = text(childValue(hostCreate, "name"));

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    const addresses = parseAddresses(childValue(hostCreate, "addr"));

    if (addresses === null) {
      return hostParameterPolicyError(context.transactionId);
    }

    try {
      const host = await this.hosts.create({ name, registrarId: context.session.clid, addresses });
      return hostCreateResponse(host, context.transactionId);
    } catch (error) {
      if (error instanceof HostAlreadyExistsError) {
        return hostObjectExists(context.transactionId);
      }

      if (error instanceof HostValidationError) {
        return hostParameterPolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async info(value: unknown, context: CommandContext): Promise<string> {
    const name = text(childValue(childNode(value, "info"), "name"));

    if (!name) {
      return syntaxError(context.transactionId);
    }

    try {
      const host = await this.hosts.findByName(name);

      if (!host) {
        return hostObjectDoesNotExist(context.transactionId);
      }

      return hostInfoResponse(host, context.transactionId);
    } catch (error) {
      if (error instanceof HostValidationError) {
        return hostParameterPolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async update(value: unknown, context: CommandContext): Promise<string> {
    const hostUpdate = childNode(value, "update");
    const name = text(childValue(hostUpdate, "name"));

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    const addressesToAdd = parseAddresses(childValue(childNode(hostUpdate, "add"), "addr"));
    const addressesToRemove = parseAddresses(childValue(childNode(hostUpdate, "rem"), "addr"));

    if (addressesToAdd === null || addressesToRemove === null) {
      return hostParameterPolicyError(context.transactionId);
    }

    try {
      await this.hosts.update(name, context.session.clid, {
        addressesToAdd,
        addressesToRemove,
        statusesToAdd: parseStatuses(childValue(childNode(hostUpdate, "add"), "status")),
        statusesToRemove: parseStatuses(childValue(childNode(hostUpdate, "rem"), "status"))
      });

      return commandCompleted(context.transactionId);
    } catch (error) {
      if (error instanceof HostNotFoundOrUnauthorizedError) {
        return hostNotAuthorized(context.transactionId);
      }

      if (error instanceof HostValidationError) {
        return hostParameterPolicyError(context.transactionId);
      }

      throw error;
    }
  }

  private async delete(value: unknown, context: CommandContext): Promise<string> {
    const name = text(childValue(childNode(value, "delete"), "name"));

    if (!name || !context.session.clid) {
      return syntaxError(context.transactionId);
    }

    try {
      await this.hosts.delete(name, context.session.clid);
      return commandCompleted(context.transactionId);
    } catch (error) {
      if (error instanceof HostNotFoundOrUnauthorizedError) {
        return hostNotAuthorized(context.transactionId);
      }

      if (error instanceof HostValidationError) {
        return hostParameterPolicyError(context.transactionId);
      }

      throw error;
    }
  }
}

/**
 * Parses host:addr nodes. Returns null when an address fails IP-family validation.
 */
function parseAddresses(value: unknown): HostAddress[] | null {
  const addresses: HostAddress[] = [];

  for (const entry of asArray(value)) {
    const ip = text(entry);

    if (!ip) {
      continue;
    }

    const declared = node(entry)?.["@_ip"];
    const version = declared === "v6" ? "v6" : "v4";
    const detected = isIP(ip);

    if (detected === 0) {
      return null;
    }

    if ((version === "v4" && detected !== 4) || (version === "v6" && detected !== 6)) {
      return null;
    }

    addresses.push({ ip, version });
  }

  return addresses;
}

function parseStatuses(value: unknown): string[] {
  return asArray(value).flatMap((entry) => {
    const status = node(entry)?.["@_s"];
    return typeof status === "string" ? [status] : [];
  });
}
