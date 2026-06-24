import test from "node:test";
import assert from "node:assert/strict";
import { extractCommand } from "./commandExtractor.js";
import { DataMockHandler } from "./dataMockHandler.js";
import type { CommandContext } from "./types.js";
import { parseEppXml } from "./xml.js";

const handler = new DataMockHandler("epp-testing-tool");

function context(): CommandContext {
  return {
    session: {
      id: "mock-session",
      authenticated: false,
      clid: "mock-registrar",
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: "",
    transactionId: "trid"
  };
}

function respond(xml: string): string {
  const document = parseEppXml(xml);
  const command = extractCommand(document);
  const ctx = context();
  ctx.transactionId = command.transactionId ?? "trid";
  return handler.respond(command.name, document, ctx);
}

const wrap = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0">${inner}</epp>`;

const login = (clid: string) =>
  wrap(`<command><login><clID>${clid}</clID><pw>any</pw></login><clTRID>l1</clTRID></command>`);
const domain = (action: string, name: string, op?: string) =>
  wrap(
    `<command><${action}${op ? ` op="${op}"` : ""}><domain:${action} xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>${name}</domain:name></domain:${action}></${action}><clTRID>d1</clTRID></command>`
  );
const contact = (action: string, id: string) =>
  wrap(
    `<command><${action}><contact:${action} xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>${id}</contact:id></contact:${action}></${action}></command>`
  );
const host = (action: string, name: string) =>
  wrap(
    `<command><${action}><host:${action} xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>${name}</host:name></host:${action}></${action}></command>`
  );

test("hello returns a greeting", () => {
  assert.match(respond(wrap("<hello/>")), /<greeting>/);
});

test("login is data-driven by clID", () => {
  assert.match(respond(login("valid-user")), /<result code="1000">/);
  assert.match(respond(login("invalid-user")), /<result code="2200">/);
});

test("domain:check availability follows the name tag", () => {
  const valid = respond(domain("check", "valid.melendez"));
  assert.match(valid, /<domain:name avail="1">valid.melendez<\/domain:name>/);

  const invalid = respond(domain("check", "invalid.melendez"));
  assert.match(invalid, /<domain:name avail="0">invalid.melendez<\/domain:name>/);
});

test("domain:create maps tags to success, exists, and policy errors", () => {
  assert.match(respond(domain("create", "valid.melendez")), /<result code="1000">/);
  assert.match(respond(domain("create", "valid.melendez")), /<domain:name>valid.melendez<\/domain:name>/);
  assert.match(respond(domain("create", "invalid.melendez")), /<result code="2302">/);
  assert.match(respond(domain("create", "policy.melendez")), /<result code="2005">/);
});

test("domain:info synthesizes infData unless the name is tagged invalid", () => {
  assert.match(respond(domain("info", "valid.melendez")), /<domain:infData/);
  assert.match(respond(domain("info", "invalid.melendez")), /<result code="2303">/);
});

test("domain:delete handles linked and invalid tags", () => {
  assert.match(respond(domain("delete", "valid.melendez")), /<result code="1000">/);
  assert.match(respond(domain("delete", "linked.melendez")), /<result code="2305">/);
  assert.match(respond(domain("delete", "invalid.melendez")), /<result code="2303">/);
});

test("domain:transfer request is pending unless invalid", () => {
  assert.match(respond(domain("transfer", "valid.melendez", "request")), /<result code="1001">/);
  assert.match(respond(domain("transfer", "valid.melendez", "request")), /<domain:trStatus>pending<\/domain:trStatus>/);
  assert.match(respond(domain("transfer", "invalid.melendez", "request")), /<result code="2303">/);
});

test("contact and host commands are data-driven", () => {
  assert.match(respond(contact("create", "valid-id")), /<result code="1000">/);
  assert.match(respond(contact("create", "invalid-id")), /<result code="2302">/);
  assert.match(respond(contact("info", "valid-id")), /<contact:infData/);
  assert.match(respond(host("create", "ns1.valid.melendez")), /<result code="1000">/);
  assert.match(respond(host("create", "ns1.invalid.melendez")), /<result code="2302">/);
});

test("poll is data-driven by op and clTRID", () => {
  assert.match(respond(wrap('<command><poll op="req"/><clTRID>poll-1</clTRID></command>')), /<result code="1300">/);
  assert.match(
    respond(wrap('<command><poll op="req"/><clTRID>poll-pending</clTRID></command>')),
    /<result code="1301">/
  );
  assert.match(respond(wrap('<command><poll op="ack" msgID="mock-msg-1"/></command>')), /<result code="1000">/);
});

test("logout ends the session", () => {
  assert.match(respond(wrap("<command><logout/></command>")), /<result code="1500">/);
});
