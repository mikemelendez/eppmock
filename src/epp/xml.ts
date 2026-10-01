import { XMLBuilder, XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  // Keep E.164 voice/fax (e.g. +1.2742995934) as strings. Default number
  // parsing drops the leading "+" and breaks RFC 5733 validation.
  parseTagValue: false
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: true,
  suppressEmptyNode: true
});

export type ParsedEpp = Record<string, unknown>;

export function parseEppXml(xml: string): ParsedEpp {
  return parser.parse(xml) as ParsedEpp;
}

export function buildEppXml(document: ParsedEpp): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(document)}`;
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}
