import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { ContactRecord } from "../contact/types.js";
import type { DomainRecord } from "../domain/types.js";
import type { HostRecord } from "../host/types.js";
import { buildRegistryExport, writeRegistryExport } from "./registryExport.js";

const domain: DomainRecord = {
  name: "example.melendez",
  registrarId: "melendez-admin",
  creatorId: "melendez-admin",
  roid: "D1-ICANNRST",
  periodYears: 1,
  statuses: ["ok"],
  nameservers: ["ns1.example.melendez", "ns2.example.net"],
  registrantContact: "EXA-001",
  contacts: [{ type: "admin", id: "EXA-001" }],
  authInfo: "secret",
  dsRecords: [{ keyTag: 39324, algorithm: 13, digestType: 2, digest: "944F1925AABB" }],
  createdAt: "2024-01-15T00:00:00.000Z",
  updatedAt: "2026-09-28T19:15:38.000Z",
  expiresAt: "2027-01-15T00:00:00.000Z"
};

const contact: ContactRecord = {
  id: "EXA-001",
  registrarId: "melendez-admin",
  creatorId: "melendez-admin",
  roid: "C1-ICANNRST",
  statuses: ["ok"],
  postalInfo: [
    {
      type: "int",
      name: "Example Registrant",
      street: ["1 Example Way"],
      city: "Los Angeles",
      sp: "CA",
      pc: "90001",
      cc: "US"
    }
  ],
  email: "hostmaster@example.melendez",
  voice: "+1.2025550101",
  createdAt: "2024-01-15T00:00:00.000Z"
};

const host: HostRecord = {
  name: "ns1.example.melendez",
  registrarId: "melendez-admin",
  creatorId: "melendez-admin",
  roid: "H1-ICANNRST",
  statuses: ["ok"],
  addresses: [
    { ip: "52.200.129.52", version: "v4" },
    { ip: "2600:1f18:79c4:5a00:91f7:3bf2:f396:c7c9", version: "v6" }
  ],
  createdAt: "2024-01-15T00:00:00.000Z"
};

test("buildRegistryExport maps EPP fields into registry.json domain objects", () => {
  const document = buildRegistryExport({
    domains: [domain],
    contacts: [contact],
    hosts: [host],
    databaseUpdated: "2026-09-30T12:00:00.000Z"
  });

  assert.equal(document.registrar.ianaId, 9999);
  assert.equal(document.databaseUpdated, "2026-09-30T12:00:00Z");
  assert.equal(document.domains.length, 1);

  const exported = document.domains[0];
  assert.equal(exported.ldhName, "example.melendez");
  assert.equal(exported.handle, "D1-ICANNRST");
  assert.deepEqual(exported.status, ["active"]);
  assert.equal(exported.registered, "2024-01-15T00:00:00Z");
  assert.equal(exported.expires, "2027-01-15T00:00:00Z");
  assert.equal(exported.changed, "2026-09-28T19:15:38Z");
  assert.deepEqual(exported.registrant, {
    handle: "EXA-001",
    fn: "Example Registrant",
    email: "hostmaster@example.melendez",
    tel: "tel:+1.2025550101",
    adr: ["", "", "1 Example Way", "Los Angeles", "CA", "90001", "US"]
  });
  assert.equal(exported.nameservers[0].ldhName, "ns1.example.melendez");
  assert.deepEqual(exported.nameservers[0].ipAddresses, {
    v4: ["52.200.129.52"],
    v6: ["2600:1f18:79c4:5a00:91f7:3bf2:f396:c7c9"]
  });
  // External NS: no glue IPs
  assert.equal(exported.nameservers[1].ldhName, "ns2.example.net");
  assert.equal(exported.nameservers[1].ipAddresses, undefined);
  assert.deepEqual(exported.dsData, [
    { keyTag: 39324, algorithm: 13, digestType: 2, digest: "944F1925AABB" }
  ]);
});

test("buildRegistryExport synthesizes registrant and in-bailiwick glue when missing", () => {
  const bare: DomainRecord = {
    ...domain,
    name: "d00001.melendez",
    registrantContact: undefined,
    contacts: [],
    nameservers: ["ns1.d00001.melendez", "ns2.d00001.melendez"]
  };

  const exported = buildRegistryExport({ domains: [bare] }).domains[0];
  assert.equal(exported.registrant.handle, "CTC-D00001");
  assert.equal(exported.registrant.email, "hostmaster@d00001.melendez");
  assert.ok(exported.nameservers[0].ipAddresses?.v4?.[0]);
  assert.ok(exported.nameservers[0].ipAddresses?.v6?.[0]);
});

test("writeRegistryExport persists registry.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "rdap-registry-"));
  const path = join(dir, "rdap", "registry.json");

  try {
    const document = buildRegistryExport({ domains: [domain], contacts: [contact], hosts: [host] });
    writeRegistryExport(path, document);
    const raw = JSON.parse(readFileSync(path, "utf8")) as { domains: unknown[] };
    assert.equal(raw.domains.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
