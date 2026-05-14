import { asArray } from "./xml.js";

type XmlNode = Record<string, unknown>;

export interface ExtractedCommand {
  name: string;
  transactionId?: string;
}

export function extractCommand(document: XmlNode): ExtractedCommand {
  const epp = node(document.epp);

  if (epp && "hello" in epp) {
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

  const firstKey = Object.keys(objectNode).find((key) => key.includes(":"));
  const prefix = firstKey?.split(":")[0];

  if (!prefix) {
    return { name: "unknown", transactionId };
  }

  return { name: `${prefix}:${action}`, transactionId };
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
