import test from "node:test";
import assert from "node:assert/strict";
import type { DomainRecord } from "../domain/types.js";
import { formatWhoisResponse } from "./whoisFormatter.js";

const domain: DomainRecord = {
  name: "xn--caf-dma.melendez",
  registrarId: "melendez-admin",
  periodYears: 1,
  statuses: ["ok"],
  nameservers: ["ns1.xn--caf-dma.melendez"],
  contacts: [{ type: "admin", id: "CONTACT-ADMIN" }],
  dsRecords: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: "ABCDEF" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z"
};

test("formats registered IDN WHOIS records", () => {
  const result = formatWhoisResponse("café.melendez", domain);

  assert.equal(result.query, "xn--caf-dma.melendez");
  assert.match(result.response, /Domain Name: xn--caf-dma\.melendez/);
  assert.match(result.response, /Unicode Name: café\.melendez/);
  assert.match(result.response, /Registrar: melendez-admin/);
  assert.match(result.response, /DS Record: 12345 13 2 ABCDEF/);
});

test("formats not found and invalid WHOIS queries", () => {
  assert.match(formatWhoisResponse("missing.melendez", null).response, /No match for "missing\.melendez"/);
  assert.match(formatWhoisResponse("example.com", null).response, /Invalid query/);
});
