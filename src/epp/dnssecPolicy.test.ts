import test from "node:test";
import assert from "node:assert/strict";
import { dnskeyKeyTag, dsRecordFromKeyData, DnssecPolicyError } from "./dnssecPolicy.js";

const RST_ED448_PUBKEY =
  "7JCMl8WwNOyFNWF6GBuMlIdtf08Cr1bO/hToZ6xCvKcu4o5ShXBzbCgzTGJHovhoUgj9wsMA1aWA";

test("derives DS from RFC 5910 keyData (ED448 / alg 16)", () => {
  const record = dsRecordFromKeyData("keydata.melendez", {
    flags: 257,
    protocol: 3,
    algorithm: 16,
    publicKey: RST_ED448_PUBKEY
  });

  assert.equal(record.algorithm, 16);
  assert.equal(record.digestType, 2);
  assert.equal(record.keyTag, 34300);
  assert.equal(record.digest.length, 64);
  assert.match(record.digest, /^[A-F0-9]{64}$/);
});

test("rejects invalid DNSKEY flags or protocol", () => {
  assert.throws(
    () =>
      dsRecordFromKeyData("example.melendez", {
        flags: 0,
        protocol: 3,
        algorithm: 13,
        publicKey: RST_ED448_PUBKEY
      }),
    DnssecPolicyError
  );
  assert.throws(
    () =>
      dsRecordFromKeyData("example.melendez", {
        flags: 256,
        protocol: 3,
        algorithm: 16,
        publicKey: RST_ED448_PUBKEY
      }),
    DnssecPolicyError
  );
  assert.throws(
    () =>
      dsRecordFromKeyData("example.melendez", {
        flags: 257,
        protocol: 1,
        algorithm: 13,
        publicKey: RST_ED448_PUBKEY
      }),
    DnssecPolicyError
  );
});

test("dnskeyKeyTag matches RFC 4034 appendix B style accumulation", () => {
  const publicKey = Buffer.from(RST_ED448_PUBKEY, "base64");
  const rdata = Buffer.concat([Buffer.from([1, 1, 3, 16]), publicKey]);
  assert.equal(dnskeyKeyTag(rdata), 34300);
});
