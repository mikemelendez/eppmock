import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { DomainRecord } from "../domain/types.js";
import { generateMelendezZone } from "./melendezZone.js";

const domain: DomainRecord = {
  name: "signed.melendez",
  registrarId: "melendez-admin",
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
    assert.match(zone, /ns1\.signed IN A 192\.0\.2\.100/);

    const keyFile = JSON.parse(readFileSync(keyPath, "utf8")) as { ksk?: unknown; zsk?: unknown };
    assert.ok(keyFile.ksk);
    assert.ok(keyFile.zsk);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
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
