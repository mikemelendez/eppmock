import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { DomainRecord } from "../domain/types.js";
import { generateMelendezZone, syntheticGlueAddresses } from "./melendezZone.js";

const domain: DomainRecord = {
  name: "signed.melendez",
  registrarId: "melendez-admin",
  creatorId: "melendez-admin",
  roid: "DTEST2-ICANNRST",
  periodYears: 1,
  statuses: ["ok"],
  nameservers: ["ns1.signed.melendez"],
  contacts: [],
  authInfo: "secret",
  dsRecords: [
    {
      keyTag: 12345,
      algorithm: 13,
      digestType: 2,
      digest: "0123456789ABCDEF"
    }
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z"
};

test("generates a signed .melendez zone with child DS and denial records", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "epp-dnssec-"));

  try {
    const keyPath = join(tempDir, "dnssec-keys.json");
    const zone = generateMelendezZone(
      [domain],
      {
        dnssec: true,
        keyAction: "generate",
        nsec3Hash: 1,
        nsec3Flags: 0,
        nsec3Iterations: 10,
        nsec3Salt: "A1B2C3D4"
      },
      { keyPath }
    );

    assert.match(zone, /@ IN DNSKEY 257 3 13 /);
    assert.match(zone, /@ IN DNSKEY 256 3 13 /);
    assert.match(zone, /@ IN DS \d+ 13 2 [A-F0-9]{64}/);
    assert.match(zone, /@ IN RRSIG DNSKEY 13 1 3600 /);
    assert.match(zone, /signed IN DS 12345 13 2 0123456789ABCDEF/);
    assert.match(zone, / IN NSEC3 1 0 10 A1B2C3D4 /);
    assert.match(zone, / IN RRSIG NSEC3 13 /);
    assert.match(zone, /@ IN SOA ns1\.melendez\. hostmaster\.ns1\.melendez\. \(/);
    assert.match(zone, /ns1 IN A 52\.200\.129\.52/);
    assert.match(zone, /ns1 IN AAAA 2600:1f18:79c4:5a00:91f7:3bf2:f396:c7c9/);
    assert.match(zone, /ns2 IN A 67\.217\.246\.69/);
    assert.match(zone, /ns2 IN AAAA 2607:f1c0:f07e:9100::1/);
    assert.match(zone, /ns1\.signed IN A 192\.0\.2\.100/);
    assert.match(zone, /ns1\.signed IN AAAA 2001:db8:1::64/);

    const keyFile = JSON.parse(readFileSync(keyPath, "utf8")) as { ksk?: unknown; zsk?: unknown };
    assert.ok(keyFile.ksk);
    assert.ok(keyFile.zsk);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("synthetic glue stays within IPv4/IPv6 field limits for 10k+ domains", () => {
  const first = syntheticGlueAddresses(0, 0);
  assert.equal(first.a, "192.0.2.100");
  assert.equal(first.aaaa, "2001:db8:1::64");

  const mid = syntheticGlueAddresses(5_000, 1);
  assert.match(mid.a, /^(192\.0\.2\.|198\.18\.)/);
  assert.match(mid.aaaa, /^2001:db8:1(?::[0-9a-f]+)?::[0-9a-f]+$/);

  const late = syntheticGlueAddresses(20_000, 1);
  assert.match(late.a, /^198\.18\.\d+\.\d+$/);
  for (const part of late.aaaa.replace("::", ":").split(":")) {
    if (!part || part === "2001" || part === "db8" || part === "1") continue;
    assert.ok(Number.parseInt(part, 16) <= 0xffff);
  }
});

test("omits DNSSEC records when DNSSEC is disabled", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "epp-dnssec-"));

  try {
    const zone = generateMelendezZone(
      [domain],
      {
        dnssec: false,
        keyAction: "generate",
        nsec3Hash: 1,
        nsec3Flags: 0,
        nsec3Iterations: 10,
        nsec3Salt: "A1B2C3D4"
      },
      { keyPath: join(tempDir, "dnssec-keys.json") }
    );

    assert.doesNotMatch(zone, /DNSKEY/);
    assert.doesNotMatch(zone, /RRSIG/);
    assert.doesNotMatch(zone, /NSEC3/);
    assert.doesNotMatch(zone, /signed IN DS/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
