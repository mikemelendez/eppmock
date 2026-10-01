import { createHash } from "node:crypto";
import type { DomainDsRecord, DomainKeyData } from "../domain/types.js";

/** IANA DNSSEC algorithm numbers commonly accepted for DS records. */
const DS_ALGORITHMS = new Set([3, 5, 6, 7, 8, 10, 12, 13, 14, 15, 16]);

const DIGEST_HEX_LENGTH: Record<number, number> = {
  1: 40,
  2: 64,
  4: 96
};

/**
 * RST epp.secDNSInterfaces=keyData only accepts SEP/KSK flags (257).
 * ZSK flags 256 are rejected as EPP_DOMAIN_*_SERVER_ACCEPTS_INVALID_DNSSEC_DATA.
 */
const DNSKEY_FLAGS = new Set([257]);

export class DnssecPolicyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function assertValidDsRecord(record: DomainDsRecord): void {
  if (!Number.isInteger(record.keyTag) || record.keyTag < 0 || record.keyTag > 65535) {
    throw new DnssecPolicyError("DS keyTag must be an unsigned short");
  }

  if (!DS_ALGORITHMS.has(record.algorithm)) {
    throw new DnssecPolicyError("DS algorithm is not a registered DNSSEC algorithm");
  }

  const digestLength = DIGEST_HEX_LENGTH[record.digestType];

  if (digestLength === undefined) {
    throw new DnssecPolicyError("DS digestType must be 1, 2, or 4");
  }

  if (!/^[A-Fa-f0-9]+$/.test(record.digest) || record.digest.length !== digestLength) {
    throw new DnssecPolicyError(`DS digest must be ${digestLength} hexadecimal characters`);
  }
}

/**
 * RFC 5910 keyData interface: accept DNSKEY material and derive a DS record
 * (SHA-256 / digest type 2 by default) for storage and zone publication.
 */
export function assertValidKeyData(keyData: DomainKeyData): void {
  if (!DNSKEY_FLAGS.has(keyData.flags)) {
    throw new DnssecPolicyError("DNSKEY flags must be 257");
  }

  if (keyData.protocol !== 3) {
    throw new DnssecPolicyError("DNSKEY protocol must be 3");
  }

  if (!DS_ALGORITHMS.has(keyData.algorithm)) {
    throw new DnssecPolicyError("DNSKEY algorithm is not a registered DNSSEC algorithm");
  }

  decodeDnskeyPublicKey(keyData.publicKey);
}

export function dsRecordFromKeyData(
  ownerName: string,
  keyData: DomainKeyData,
  digestType = 2
): DomainDsRecord {
  assertValidKeyData(keyData);

  const publicKeyWire = decodeDnskeyPublicKey(keyData.publicKey);
  const dnskeyRdata = Buffer.concat([
    uint16(keyData.flags),
    Buffer.from([keyData.protocol, keyData.algorithm]),
    publicKeyWire
  ]);
  const keyTag = dnskeyKeyTag(dnskeyRdata);
  const digest = dsDigestHex(ownerName, dnskeyRdata, digestType);
  const record: DomainDsRecord = {
    keyTag,
    algorithm: keyData.algorithm,
    digestType,
    digest
  };
  assertValidDsRecord(record);
  return record;
}

export function keyDataKey(record: DomainKeyData): string {
  return `${record.flags}:${record.protocol}:${record.algorithm}:${record.publicKey.replace(/\s+/g, "")}`;
}

function decodeDnskeyPublicKey(value: string): Buffer {
  const compact = value.replace(/\s+/g, "");

  if (!compact || !/^[A-Za-z0-9+/]+=*$/.test(compact)) {
    throw new DnssecPolicyError("DNSKEY public key must be base64");
  }

  const decoded = Buffer.from(compact, "base64");

  if (decoded.length === 0) {
    throw new DnssecPolicyError("DNSKEY public key must be base64");
  }

  return decoded;
}

/** RFC 4034 §5.1.4 key tag over DNSKEY RDATA. */
export function dnskeyKeyTag(dnskeyRdata: Buffer): number {
  let ac = 0;

  for (const [index, byte] of dnskeyRdata.entries()) {
    ac += index & 1 ? byte : byte << 8;
  }

  ac += (ac >> 16) & 0xffff;
  return ac & 0xffff;
}

function dsDigestHex(ownerName: string, dnskeyRdata: Buffer, digestType: number): string {
  const hashName = digestType === 1 ? "sha1" : digestType === 4 ? "sha384" : "sha256";
  return createHash(hashName)
    .update(Buffer.concat([nameToWire(ownerName), dnskeyRdata]))
    .digest("hex")
    .toUpperCase();
}

function nameToWire(name: string): Buffer {
  const labels = name
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  return Buffer.concat([
    ...labels.map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0])
  ]);
}

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}
