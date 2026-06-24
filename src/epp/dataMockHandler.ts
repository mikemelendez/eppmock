import { randomUUID } from "node:crypto";
import type { ContactRecord } from "../contact/types.js";
import type { DomainRecord } from "../domain/types.js";
import type { HostAddress, HostRecord } from "../host/types.js";
import { childNode, childValue, getCommand, node, stringValues, text } from "./commandExtractor.js";
import {
  contactCheckResponse,
  contactCreateResponse,
  contactInfoResponse,
  contactObjectDoesNotExist,
  contactObjectExists
} from "./contactResponses.js";
import { includesTag, MOCK_TAGS } from "./dataMockCatalog.js";
import {
  domainCheckResponse,
  domainCreateResponse,
  domainInfoResponse,
  domainRenewResponse,
  objectDoesNotExist,
  objectExists,
  parameterValuePolicyError
} from "./domainResponses.js";
import {
  hostCheckResponse,
  hostCreateResponse,
  hostInfoResponse,
  hostObjectDoesNotExist,
  hostObjectExists
} from "./hostResponses.js";
import {
  authenticationError,
  commandCompleted,
  greeting,
  pollAckResponse,
  pollMessageResponse,
  pollNoMessages,
  resultResponse,
  syntaxError,
  unknownCommand
} from "./responses.js";
import type { CommandContext } from "./types.js";
import { asArray, buildEppXml } from "./xml.js";

const MOCK_REGISTRAR = "mock-registrar";

/**
 * Stateless EPP handler for data-based mock mode. Every response is derived from substrings
 * ("tags") in the request data (see dataMockCatalog.ts) and never touches a database.
 */
export class DataMockHandler {
  constructor(private readonly serverId: string) {}

  respond(commandName: string, document: Record<string, unknown>, context: CommandContext): string {
    const trid = context.transactionId;
    const registrarId = context.session.clid ?? MOCK_REGISTRAR;

    switch (commandName) {
      case "hello":
        return greeting(this.serverId);
      case "login":
        return this.login(document, trid);
      case "logout":
        return resultResponse(1500, "Command completed successfully; ending session", trid);
      case "domain:check":
        return this.domainCheck(document, trid);
      case "domain:create":
        return this.domainCreate(document, registrarId, trid);
      case "domain:info":
        return this.domainInfo(document, registrarId, trid);
      case "domain:update":
        return this.simpleObjectMutation(document, "update", "name", trid, objectDoesNotExist);
      case "domain:delete":
        return this.domainDelete(document, trid);
      case "domain:renew":
        return this.domainRenew(document, registrarId, trid);
      case "domain:transfer":
        return this.domainTransfer(document, registrarId, trid);
      case "contact:check":
        return this.contactCheck(document, trid);
      case "contact:create":
        return this.contactCreate(document, registrarId, trid);
      case "contact:info":
        return this.contactInfo(document, registrarId, trid);
      case "contact:update":
        return this.simpleObjectMutation(document, "update", "id", trid, contactObjectDoesNotExist);
      case "contact:delete":
        return this.simpleObjectMutation(document, "delete", "id", trid, contactObjectDoesNotExist);
      case "host:check":
        return this.hostCheck(document, trid);
      case "host:create":
        return this.hostCreate(document, registrarId, trid);
      case "host:info":
        return this.hostInfo(document, registrarId, trid);
      case "host:update":
        return this.simpleObjectMutation(document, "update", "name", trid, hostObjectDoesNotExist);
      case "host:delete":
        return this.simpleObjectMutation(document, "delete", "name", trid, hostObjectDoesNotExist);
      case "poll":
        return this.poll(document, trid);
      default:
        return unknownCommand(trid);
    }
  }

  private login(document: Record<string, unknown>, trid?: string): string {
    const loginNode = node(childValue(getCommand(document), "login"));
    const clid = text(childValue(loginNode, "clID"));

    if (includesTag(clid, MOCK_TAGS.invalid)) {
      return authenticationError(trid);
    }

    return commandCompleted(trid);
  }

  private domainCheck(document: Record<string, unknown>, trid?: string): string {
    const names = objectIdentifiers(document, "check", "name");

    if (names.length === 0) {
      return syntaxError(trid);
    }

    const results = names.map((name) => ({
      name,
      available: !includesTag(name, MOCK_TAGS.invalid) && !includesTag(name, MOCK_TAGS.unavailable)
    }));

    return domainCheckResponse(results, trid);
  }

  private domainCreate(document: Record<string, unknown>, registrarId: string, trid?: string): string {
    const name = firstObjectIdentifier(document, "create", "name");

    if (!name) {
      return syntaxError(trid);
    }

    if (includesTag(name, MOCK_TAGS.invalid)) {
      return objectExists(trid);
    }

    if (includesTag(name, MOCK_TAGS.policy)) {
      return parameterValuePolicyError(trid);
    }

    return domainCreateResponse(synthDomain(name, document, registrarId), trid);
  }

  private domainInfo(document: Record<string, unknown>, registrarId: string, trid?: string): string {
    const name = firstObjectIdentifier(document, "info", "name");

    if (!name) {
      return syntaxError(trid);
    }

    if (includesTag(name, MOCK_TAGS.invalid)) {
      return objectDoesNotExist(trid);
    }

    return domainInfoResponse(synthDomain(name, document, registrarId, true), trid);
  }

  private domainDelete(document: Record<string, unknown>, trid?: string): string {
    const name = firstObjectIdentifier(document, "delete", "name");

    if (!name) {
      return syntaxError(trid);
    }

    if (includesTag(name, MOCK_TAGS.invalid)) {
      return objectDoesNotExist(trid);
    }

    if (includesTag(name, MOCK_TAGS.linked)) {
      return resultResponse(2305, "Object association prohibits operation", trid);
    }

    return commandCompleted(trid);
  }

  private domainRenew(document: Record<string, unknown>, registrarId: string, trid?: string): string {
    const name = firstObjectIdentifier(document, "renew", "name");

    if (!name) {
      return syntaxError(trid);
    }

    if (includesTag(name, MOCK_TAGS.invalid)) {
      return objectDoesNotExist(trid);
    }

    return domainRenewResponse(synthDomain(name, document, registrarId, true), trid);
  }

  private domainTransfer(document: Record<string, unknown>, registrarId: string, trid?: string): string {
    const name = firstObjectIdentifier(document, "transfer", "name");

    if (!name) {
      return syntaxError(trid);
    }

    if (includesTag(name, MOCK_TAGS.invalid)) {
      return objectDoesNotExist(trid);
    }

    const now = new Date().toISOString();
    return buildEppXml({
      epp: {
        "@_xmlns": "urn:ietf:params:xml:ns:epp-1.0",
        response: {
          result: { "@_code": 1001, msg: "Command completed successfully; action pending" },
          resData: {
            "domain:trnData": {
              "@_xmlns:domain": "urn:ietf:params:xml:ns:domain-1.0",
              "domain:name": name,
              "domain:trStatus": "pending",
              "domain:reID": registrarId,
              "domain:reDate": now,
              "domain:acID": MOCK_REGISTRAR,
              "domain:acDate": now
            }
          },
          trID: { clTRID: trid, svTRID: randomUUID() }
        }
      }
    });
  }

  private contactCheck(document: Record<string, unknown>, trid?: string): string {
    const ids = objectIdentifiers(document, "check", "id");

    if (ids.length === 0) {
      return syntaxError(trid);
    }

    return contactCheckResponse(
      ids.map((id) => ({ id, available: !includesTag(id, MOCK_TAGS.invalid) })),
      trid
    );
  }

  private contactCreate(document: Record<string, unknown>, registrarId: string, trid?: string): string {
    const id = firstObjectIdentifier(document, "create", "id");

    if (!id) {
      return syntaxError(trid);
    }

    if (includesTag(id, MOCK_TAGS.invalid)) {
      return contactObjectExists(trid);
    }

    return contactCreateResponse(synthContact(id, registrarId), trid);
  }

  private contactInfo(document: Record<string, unknown>, registrarId: string, trid?: string): string {
    const id = firstObjectIdentifier(document, "info", "id");

    if (!id) {
      return syntaxError(trid);
    }

    if (includesTag(id, MOCK_TAGS.invalid)) {
      return contactObjectDoesNotExist(trid);
    }

    return contactInfoResponse(synthContact(id, registrarId), trid);
  }

  private hostCheck(document: Record<string, unknown>, trid?: string): string {
    const names = objectIdentifiers(document, "check", "name");

    if (names.length === 0) {
      return syntaxError(trid);
    }

    return hostCheckResponse(
      names.map((name) => ({ name, available: !includesTag(name, MOCK_TAGS.invalid) })),
      trid
    );
  }

  private hostCreate(document: Record<string, unknown>, registrarId: string, trid?: string): string {
    const name = firstObjectIdentifier(document, "create", "name");

    if (!name) {
      return syntaxError(trid);
    }

    if (includesTag(name, MOCK_TAGS.invalid)) {
      return hostObjectExists(trid);
    }

    return hostCreateResponse(synthHost(name, document, registrarId), trid);
  }

  private hostInfo(document: Record<string, unknown>, registrarId: string, trid?: string): string {
    const name = firstObjectIdentifier(document, "info", "name");

    if (!name) {
      return syntaxError(trid);
    }

    if (includesTag(name, MOCK_TAGS.invalid)) {
      return hostObjectDoesNotExist(trid);
    }

    return hostInfoResponse(synthHost(name, document, registrarId, true), trid);
  }

  private poll(document: Record<string, unknown>, trid?: string): string {
    const pollNode = node(childValue(getCommand(document), "poll"));
    const operation = typeof pollNode?.["@_op"] === "string" ? pollNode["@_op"] : "req";

    if (operation === "ack") {
      const messageId = typeof pollNode?.["@_msgID"] === "string" ? pollNode["@_msgID"] : "mock-msg-1";
      return pollAckResponse(messageId, 0, trid);
    }

    if (includesTag(trid, MOCK_TAGS.pending)) {
      return pollMessageResponse(
        {
          id: "mock-msg-1",
          enqueuedAt: new Date().toISOString(),
          text: "Mock service message; ack to dequeue",
          remaining: 1
        },
        trid
      );
    }

    return pollNoMessages(trid);
  }

  private simpleObjectMutation(
    document: Record<string, unknown>,
    action: string,
    childLocal: string,
    trid: string | undefined,
    notFound: (transactionId?: string) => string
  ): string {
    const identifier = firstObjectIdentifier(document, action, childLocal);

    if (!identifier) {
      return syntaxError(trid);
    }

    if (includesTag(identifier, MOCK_TAGS.invalid)) {
      return notFound(trid);
    }

    return commandCompleted(trid);
  }
}

function objectActionNode(document: Record<string, unknown>, action: string): Record<string, unknown> | undefined {
  const actionContainer = childValue(getCommand(document), action);
  return childNode(actionContainer, action);
}

function objectIdentifiers(document: Record<string, unknown>, action: string, childLocal: string): string[] {
  return stringValues(childValue(objectActionNode(document, action), childLocal));
}

function firstObjectIdentifier(
  document: Record<string, unknown>,
  action: string,
  childLocal: string
): string | undefined {
  return objectIdentifiers(document, action, childLocal)[0];
}

function synthDomain(
  name: string,
  document: Record<string, unknown>,
  registrarId: string,
  fillDefaults = false
): DomainRecord {
  const createNode = objectActionNode(document, "create") ?? objectActionNode(document, "info");
  const nameservers = stringValues(childValue(childNode(createNode, "ns"), "hostObj"));
  const registrant = text(childValue(createNode, "registrant"));
  const authInfo = text(childValue(childNode(createNode, "authInfo"), "pw"));
  const period = Number(text(childValue(createNode, "period")) ?? "1") || 1;

  const createdAt = new Date();
  const expiresAt = new Date(createdAt);
  expiresAt.setFullYear(expiresAt.getFullYear() + period);

  return {
    name,
    registrarId,
    periodYears: period,
    statuses: ["ok"],
    nameservers: nameservers.length > 0 ? nameservers : fillDefaults ? [`ns1.${name}`, `ns2.${name}`] : [],
    registrantContact: registrant ?? (fillDefaults ? "mock-registrant" : undefined),
    contacts: [],
    authInfo: authInfo ?? (fillDefaults ? "mock-authinfo" : undefined),
    dsRecords: [],
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

function synthContact(id: string, registrarId: string): ContactRecord {
  return {
    id,
    registrarId,
    roid: `${id.toUpperCase()}-EPP`,
    statuses: ["ok"],
    postalInfo: [
      {
        type: "int",
        name: "Mock Registrant",
        street: ["123 Mock Street"],
        city: "Mock City",
        cc: "US"
      }
    ],
    email: `${id}@example.melendez`,
    createdAt: new Date().toISOString()
  };
}

function synthHost(
  name: string,
  document: Record<string, unknown>,
  registrarId: string,
  fillDefaults = false
): HostRecord {
  const createNode = objectActionNode(document, "create") ?? objectActionNode(document, "info");
  const addresses = parseHostAddresses(childValue(createNode, "addr"));

  return {
    name,
    registrarId,
    roid: `${name.toUpperCase()}-EPP`,
    statuses: ["ok"],
    addresses:
      addresses.length > 0
        ? addresses
        : fillDefaults
          ? [
              { ip: "192.0.2.1", version: "v4" },
              { ip: "2001:db8::1", version: "v6" }
            ]
          : [],
    createdAt: new Date().toISOString()
  };
}

function parseHostAddresses(value: unknown): HostAddress[] {
  return asArray(value).flatMap((entry) => {
    const ip = text(entry);

    if (!ip) {
      return [];
    }

    const version = node(entry)?.["@_ip"] === "v6" ? "v6" : "v4";
    return [{ ip, version }];
  });
}
