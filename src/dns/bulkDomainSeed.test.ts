import test from "node:test";
import assert from "node:assert/strict";
import { planBulkDomainSeed } from "./bulkDomainSeed.js";
import type { DomainRecord } from "../domain/types.js";

function sampleDomain(name: string): DomainRecord {
  return {
    name,
    registrarId: "melendez-admin",
    creatorId: "melendez-admin",
    roid: "D1-ICANNRST",
    periodYears: 1,
    statuses: ["ok"],
    nameservers: [`ns1.${name}`],
    contacts: [],
    authInfo: "secret",
    dsRecords: [{ keyTag: 1, algorithm: 13, digestType: 2, digest: "AA" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2027-01-01T00:00:00.000Z"
  };
}

test("planBulkDomainSeed keeps defaults and builds deterministic DS delegations", () => {
  const existing = [
    sampleDomain("nic.melendez"),
    sampleDomain("miguel.melendez"),
    sampleDomain("example.melendez"),
    sampleDomain("scratch.melendez")
  ];

  const plan = planBulkDomainSeed(existing, { count: 25, prefix: "d" });

  assert.equal(plan.keep.length, 3);
  assert.equal(plan.generated.length, 25);
  assert.equal(plan.all.length, 28);
  assert.ok(!plan.all.some((domain) => domain.name === "scratch.melendez"));

  const first = plan.generated[0];
  assert.equal(first.name, "d00001.melendez");
  assert.deepEqual(first.nameservers, ["ns1.d00001.melendez", "ns2.d00001.melendez"]);
  assert.equal(first.dsRecords.length, 1);
  assert.equal(first.dsRecords[0].algorithm, 13);
  assert.equal(first.dsRecords[0].digestType, 2);
  assert.match(first.dsRecords[0].digest, /^[A-F0-9]{64}$/);
  assert.equal(first.roid, "D0000000001-ICANNRST");

  assert.equal(plan.generated[24].name, "d00025.melendez");
});

test("planBulkDomainSeed rejects out-of-range counts", () => {
  assert.throws(() => planBulkDomainSeed([], { count: 0 }), /count must be/);
  assert.throws(() => planBulkDomainSeed([], { count: 50_001 }), /count must be/);
});
