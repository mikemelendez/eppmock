import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createSign, createVerify, createPublicKey } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { DomainRecord } from "../domain/types.js";
import { generateMelendezZone } from "./melendezZone.js";
import { DnssecKeyStore, dnssecPublicKey } from "./dnssecKeyStore.js";

const domain: DomainRecord = {
  name: "verify.melendez",
  registrarId: "melendez-admin",
  creatorId: "melendez-admin",
  roid: "DVERIFY-ICANNRST",
  periodYears: 1,
  statuses: ["ok"],
  nameservers: ["ns1.verify.melendez"],
  contacts: [],
  authInfo: "secret",
  dsRecords: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z"
};

function signedZone(tempDir: string): string {
  return generateMelendezZone(
    [domain],
    {
      dnssec: true,
      keyAction: "generate",
      nsec3Hash: 1,
      nsec3Flags: 0,
      nsec3Iterations: 0,
      nsec3Salt: "-"
    },
    { keyPath: join(tempDir, "dnssec-keys.json") }
  );
}

test("RRSIG presentation times are RFC 4034 YYYYMMDDHHmmSS without T", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "epp-dnssec-time-"));

  try {
    const zone = signedZone(tempDir);
    const times = [...zone.matchAll(/IN RRSIG \S+ 13 \d+ \d+ (\d+) (\d+) /g)];
    assert.ok(times.length > 0);

    for (const match of times) {
      assert.match(match[1], /^\d{14}$/);
      assert.match(match[2], /^\d{14}$/);
      assert.doesNotMatch(match[1], /T/);
      assert.doesNotMatch(match[2], /T/);
    }

    assert.match(zone, /@ IN NSEC3PARAM 1 0 0 -/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("alg-13 signatures are IEEE-P1363 r||s and match published DNSKEY material", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "epp-dnssec-p1363-"));

  try {
    const keyPath = join(tempDir, "dnssec-keys.json");
    const zone = signedZone(tempDir);
    const keys = new DnssecKeyStore(keyPath).loadOrCreate("generate");
    const kskB64 = dnssecPublicKey(keys.ksk.publicKeyPem);
    const zskB64 = dnssecPublicKey(keys.zsk.publicKeyPem);

    assert.match(zone, new RegExp(`@ IN DNSKEY 257 3 13 ${escapeRegExp(kskB64)}`));
    assert.match(zone, new RegExp(`@ IN DNSKEY 256 3 13 ${escapeRegExp(zskB64)}`));

    const sample = Buffer.from("dnssec-alg13-self-check");
    for (const pair of [keys.ksk, keys.zsk]) {
      const signature = createSign("SHA256")
        .update(sample)
        .sign({ key: pair.privateKeyPem, dsaEncoding: "ieee-p1363" });
      assert.equal(signature.length, 64);
      assert.equal(
        createVerify("SHA256").update(sample).verify(
          { key: createPublicKey(pair.publicKeyPem), dsaEncoding: "ieee-p1363" },
          signature
        ),
        true
      );
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dnspython validates DNSKEY and SOA RRSIGs from zone output", (t) => {
  try {
    execFileSync("python3", ["-c", "import dns.zone, dns.dnssec, cryptography"], { stdio: "pipe" });
  } catch {
    t.skip("dnspython and cryptography required");
    return;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "epp-dnssec-py-"));

  try {
    const zone = signedZone(tempDir);
    const zonePath = join(tempDir, "melendez.zone");
    writeFileSync(zonePath, zone);

    const script = `
import dns.zone, dns.dnssec, dns.rdatatype, dns.name
z = dns.zone.from_file(${JSON.stringify(zonePath)}, origin="melendez.", relativize=False)
origin = dns.name.from_text("melendez.")
dnskeys = z.find_rdataset(origin, dns.rdatatype.DNSKEY)
now = None
for rds in z[origin]:
    if rds.rdtype == dns.rdatatype.RRSIG and rds.covers == dns.rdatatype.DNSKEY:
        now = rds[0].inception + 60
for rdtype in (dns.rdatatype.DNSKEY, dns.rdatatype.SOA):
    rrset = z.find_rdataset(origin, rdtype)
    sigs = None
    for rds in z[origin]:
        if rds.rdtype == dns.rdatatype.RRSIG and rds.covers == rdtype:
            sigs = rds
    assert sigs is not None, f"missing RRSIG {rdtype}"
    dns.dnssec.validate((origin, rrset), (origin, sigs), {origin: dnskeys}, now=now)
    print("VALID", dns.rdatatype.to_text(rdtype), "tag", sigs[0].key_tag)
print("SERIAL", list(z.find_rdataset(origin, dns.rdatatype.SOA))[0].serial)
`;
    const output = execFileSync("python3", ["-c", script], { encoding: "utf8" });
    assert.match(output, /VALID DNSKEY tag \d+/);
    assert.match(output, /VALID SOA tag \d+/);
    assert.match(output, /SERIAL \d+/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
