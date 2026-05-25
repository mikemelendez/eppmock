import { asArray } from "./xml.js";

type XmlNode = Record<string, unknown>;

export interface ExtractedCommand {
  name: string;
  transactionId?: string;
}

export function extractCommand(document: XmlNode): ExtractedCommand {
  const epp = node(document.epp);

  if (epp && hasChild(epp, "hello")) {
    return { name: "hello" };
  }

  const command = getCommand(document);

  if (!command) {
    return { name: "unknown" };
  }

  const transactionId = text(command.clTRID);

  if ("login" in command) {
    return { name: "login", transactionId };
  }

  if ("logout" in command) {
    return { name: "logout", transactionId };
  }

  if ("check" in command) {
    return objectCommandName("check", command.check, transactionId);
  }

  if ("create" in command) {
    return objectCommandName("create", command.create, transactionId);
  }

  if ("info" in command) {
    return objectCommandName("info", command.info, transactionId);
  }

  if ("delete" in command) {
    return objectCommandName("delete", command.delete, transactionId);
  }

  if ("update" in command) {
    return objectCommandName("update", command.update, transactionId);
  }

  if ("renew" in command) {
    return objectCommandName("renew", command.renew, transactionId);
  }

  if ("transfer" in command) {
    return objectCommandName("transfer", command.transfer, transactionId);
  }

  if ("poll" in command) {
    return { name: "poll", transactionId };
  }

  if ("hello" in command) {
    return { name: "hello", transactionId };
  }

  return { name: "unknown", transactionId };
}

export function getCommand(document: XmlNode): XmlNode | undefined {
  const epp = node(document.epp);
  return node(epp?.command);
}

function objectCommandName(action: string, value: unknown, transactionId?: string): ExtractedCommand {
  const objectNode = node(value);

  if (!objectNode) {
    return { name: "unknown", transactionId };
  }

  const firstKey = Object.keys(objectNode).find((key) => localName(key) === action);
  const prefix = firstKey?.includes(":") ? firstKey.split(":")[0] : inferObjectPrefix(objectNode, action);

  if (!prefix) {
    return { name: "unknown", transactionId };
  }

  return { name: `${prefix}:${action}`, transactionId };
}

export function childNode(value: unknown, childLocalName: string): XmlNode | undefined {
  return node(childValue(value, childLocalName));
}

export function childValue(value: unknown, childLocalName: string): unknown {
  const valueNode = node(value);
  const key = Object.keys(valueNode ?? {}).find((entry) => localName(entry) === childLocalName);
  return key ? valueNode?.[key] : undefined;
}

export function hasChild(value: unknown, childLocalName: string): boolean {
  return childValue(value, childLocalName) !== undefined;
}

function localName(key: string): string {
  return key.includes(":") ? key.split(":").at(-1) ?? key : key;
}

function inferObjectPrefix(objectNode: XmlNode, action: string): string | undefined {
  const domainActions = new Set(["check", "create", "info", "delete", "update", "renew", "transfer"]);

  if (!domainActions.has(action)) {
    return undefined;
  }

  if (Object.keys(objectNode).some((key) => key.startsWith("domain:") || localName(key) === action)) {
    return "domain";
  }

  return undefined;
}

export function node(value: unknown): XmlNode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as XmlNode;
}

export function text(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  const valueNode = node(value);

  if (typeof valueNode?.["#text"] === "string") {
    return valueNode["#text"];
  }

  if (typeof valueNode?.["#text"] === "number") {
    return String(valueNode["#text"]);
  }

  return undefined;
}

export function stringValues(value: unknown): string[] {
  return asArray(value).flatMap((entry) => {
    const entryText = text(entry);
    return entryText ? [entryText] : [];
  });
}
