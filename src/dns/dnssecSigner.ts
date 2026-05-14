import { createHash, createSign } from "node:crypto";
import type { DnssecKeySet } from "./dnssecKeyStore.js";
import { dnssecPublicKey } from "./dnssecKeyStore.js";
import type { DnsZoneOptions, ZoneRecord } from "./types.js";

const origin = "melendez.";
const algorithm = 13;
const protocol = 3;
const digestType = 2;
const defaultTtl = 3600;

export interface SignedZone {
  records: ZoneRecord[];
  kskKeyTag: number;
  zskKeyTag: number;
}

interface SigningKey {
  flags: 256 | 257;
  publicKey: string;
  privateKeyPem: string;
  keyTag: number;
}

export function signZoneRecords(records: ZoneRecord[], options: DnsZoneOptions, keySet: DnssecKeySet): SignedZone {
  const ksk = signingKey(257, keySet.ksk.privateKeyPem, keySet.ksk.publicKeyPem);
  const zsk = signingKey(256, keySet.zsk.privateKeyPem, keySet.zsk.publicKeyPem);
  const dnskeyRecords: ZoneRecord[] = [
    { owner: "@", type: "DNSKEY", ttl: defaultTtl, rdata: `${ksk.flags} ${protocol} ${algorithm} ${ksk.publicKey}` },
    { owner: "@", type: "DNSKEY", ttl: defaultTtl, rdata: `${zsk.flags} ${protocol} ${algorithm} ${zsk.publicKey}` }
  ];
  const dsRecord: ZoneRecord = {
    owner: "@",
    type: "DS",
    ttl: defaultTtl,
    rdata: `${ksk.keyTag} ${algorithm} ${digestType} ${dsDigest("@", dnskeyRecords[0])}`
  };
  const nsec3ParamRecord: ZoneRecord = {
    owner: "@",
    type: "NSEC3PARAM",
    ttl: defaultTtl,
    rdata: `${options.nsec3Hash} ${options.nsec3Flags} ${options.nsec3Iterations} ${nsec3Salt(options)}`
  };
  const unsignedRecords = [...dnskeyRecords, dsRecord, nsec3ParamRecord, ...records];
  const nsec3Records = buildNsec3Records(unsignedRecords, options);
  const signableRecords = [...unsignedRecords, ...nsec3Records];
  const signatures = rrsets(signableRecords).map((rrset) =>
    rrsigRecord(rrset, rrset.type === "DNSKEY" ? ksk : zsk)
  );

  return {
    records: [
      { owner: "; DNSSEC", type: "COMMENT", ttl: defaultTtl, rdata: "signed zone metadata" },
      ...dnskeyRecords,
      dsRecord,
      nsec3ParamRecord,
      { owner: "; KSK", type: "COMMENT", ttl: defaultTtl, rdata: `key tag ${ksk.keyTag}` },
      { owner: "; ZSK", type: "COMMENT", ttl: defaultTtl, rdata: `key tag ${zsk.keyTag}` },
      ...records,
      ...nsec3Records,
      ...signatures
    ],
    kskKeyTag: ksk.keyTag,
    zskKeyTag: zsk.keyTag
  };
}

export function keyTagForDnskey(record: ZoneRecord): number {
  const rdata = rdataToWire(record);
  let ac = 0;

  for (const [index, byte] of rdata.entries()) {
    ac += index & 1 ? byte : byte << 8;
  }

  ac += (ac >> 16) & 0xffff;
  return ac & 0xffff;
}

function signingKey(flags: 256 | 257, privateKeyPem: string, publicKeyPem: string): SigningKey {
  const publicKey = dnssecPublicKey(publicKeyPem);
  const dnskeyRecord: ZoneRecord = {
    owner: "@",
    type: "DNSKEY",
    ttl: defaultTtl,
    rdata: `${flags} ${protocol} ${algorithm} ${publicKey}`
  };

  return {
    flags,
    publicKey,
    privateKeyPem,
    keyTag: keyTagForDnskey(dnskeyRecord)
  };
}

function buildNsec3Records(records: ZoneRecord[], options: DnsZoneOptions): ZoneRecord[] {
  const byOwner = new Map<string, Set<string>>();

  for (const record of records) {
    if (record.type === "COMMENT") {
      continue;
    }

    const ownerName = ownerFqdn(record.owner);
    byOwner.set(ownerName, byOwner.get(ownerName) ?? new Set());
    byOwner.get(ownerName)?.add(record.type);
  }

  const hashedOwners = [...byOwner.entries()]
    .map(([ownerName, types]) => ({
      ownerName,
      hash: nsec3Hash(ownerName, options),
      types: [...types, "RRSIG"].sort((a, b) => typeCode(a) - typeCode(b))
    }))
    .sort((a, b) => a.hash.localeCompare(b.hash));

  return hashedOwners.map((entry, index) => {
    const next = hashedOwners[(index + 1) % hashedOwners.length] ?? entry;
    return {
      owner: entry.hash,
      type: "NSEC3",
      ttl: defaultTtl,
      rdata: `${options.nsec3Hash} ${options.nsec3Flags} ${options.nsec3Iterations} ${nsec3Salt(options)} ${next.hash} ${entry.types.join(" ")}`
    };
  });
}

function rrsets(records: ZoneRecord[]): Array<{ owner: string; type: string; records: ZoneRecord[] }> {
  const grouped = new Map<string, ZoneRecord[]>();

  for (const record of records) {
    if (record.type === "COMMENT" || record.type === "RRSIG") {
      continue;
    }

    const key = `${ownerFqdn(record.owner)}|${record.type}`;
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }

  return [...grouped.values()].map((recordsForSet) => ({
    owner: recordsForSet[0].owner,
    type: recordsForSet[0].type,
    records: recordsForSet.sort((a, b) => canonicalRecord(a, a.ttl).compare(canonicalRecord(b, b.ttl)))
  }));
}

function rrsigRecord(rrset: { owner: string; type: string; records: ZoneRecord[] }, key: SigningKey): ZoneRecord {
  const inception = dnssecTime(new Date(Date.now() - 60_000));
  const expiration = dnssecTime(new Date(Date.now() + 1000 * 60 * 60 * 24 * 30));
  const ttl = rrset.records[0].ttl;
  const labels = ownerLabels(rrset.owner);
  const signerName = origin;
  const rrsigPrefix = Buffer.concat([
    uint16(typeCode(rrset.type)),
    Buffer.from([algorithm, labels]),
    uint32(ttl),
    dnssecTimeBuffer(expiration),
    dnssecTimeBuffer(inception),
    uint16(key.keyTag),
    nameToWire(signerName)
  ]);
  const signedData = Buffer.concat([
    rrsigPrefix,
    ...rrset.records.map((record) => canonicalRecord(record, ttl))
  ]);
  const signature = derToDnsEcdsa(createSign("SHA256").update(signedData).sign(key.privateKeyPem)).toString("base64");

  return {
    owner: rrset.owner,
    type: "RRSIG",
    ttl,
    rdata: `${rrset.type} ${algorithm} ${labels} ${ttl} ${expiration} ${inception} ${key.keyTag} ${signerName} ${signature}`
  };
}

function canonicalRecord(record: ZoneRecord, originalTtl: number): Buffer {
  const rdata = rdataToWire(record);
  return Buffer.concat([
    nameToWire(ownerFqdn(record.owner)),
    uint16(typeCode(record.type)),
    uint16(1),
    uint32(originalTtl),
    uint16(rdata.length),
    rdata
  ]);
}

function rdataToWire(record: ZoneRecord): Buffer {
  const parts = record.rdata.split(/\s+/).filter(Boolean);

  if (record.type === "A") {
    return Buffer.from(parts[0].split(".").map((part) => Number(part)));
  }

  if (record.type === "NS") {
    return nameToWire(parts[0]);
  }

  if (record.type === "SOA") {
    return Buffer.concat([
      nameToWire(parts[0]),
      nameToWire(parts[1]),
      ...parts.slice(2, 7).map((part) => uint32(Number(part)))
    ]);
  }

  if (record.type === "DNSKEY") {
    return Buffer.concat([uint16(Number(parts[0])), Buffer.from([Number(parts[1]), Number(parts[2])]), Buffer.from(parts[3], "base64")]);
  }

  if (record.type === "DS") {
    return Buffer.concat([uint16(Number(parts[0])), Buffer.from([Number(parts[1]), Number(parts[2])]), Buffer.from(parts[3], "hex")]);
  }

  if (record.type === "NSEC3PARAM") {
    const salt = parts[3] === "-" ? Buffer.alloc(0) : Buffer.from(parts[3], "hex");
    return Buffer.concat([Buffer.from([Number(parts[0]), Number(parts[1])]), uint16(Number(parts[2])), Buffer.from([salt.length]), salt]);
  }

  if (record.type === "NSEC3") {
    const salt = parts[3] === "-" ? Buffer.alloc(0) : Buffer.from(parts[3], "hex");
    const next = base32HexToBuffer(parts[4]);
    return Buffer.concat([
      Buffer.from([Number(parts[0]), Number(parts[1])]),
      uint16(Number(parts[2])),
      Buffer.from([salt.length]),
      salt,
      Buffer.from([next.length]),
      next,
      typeBitmap(parts.slice(5))
    ]);
  }

  throw new Error(`Unsupported DNSSEC record type: ${record.type}`);
}

function dsDigest(owner: string, dnskey: ZoneRecord): string {
  return createHash("sha256").update(Buffer.concat([nameToWire(ownerFqdn(owner)), rdataToWire(dnskey)])).digest("hex").toUpperCase();
}

function nsec3Hash(ownerName: string, options: DnsZoneOptions): string {
  const salt = nsec3Salt(options) === "-" ? Buffer.alloc(0) : Buffer.from(nsec3Salt(options), "hex");
  let digest = createHash("sha1").update(Buffer.concat([nameToWire(ownerName), salt])).digest();

  for (let index = 0; index < options.nsec3Iterations; index += 1) {
    digest = createHash("sha1").update(Buffer.concat([digest, salt])).digest();
  }

  return base32Hex(digest);
}

function nsec3Salt(options: DnsZoneOptions): string {
  return options.nsec3Salt === "-" ? "-" : options.nsec3Salt.toUpperCase();
}

function ownerFqdn(owner: string): string {
  if (owner === "@") {
    return origin;
  }

  return owner.endsWith(".") ? owner.toLowerCase() : `${owner.toLowerCase()}.${origin}`;
}

function ownerLabels(owner: string): number {
  return ownerFqdn(owner)
    .split(".")
    .filter(Boolean).length;
}

function nameToWire(name: string): Buffer {
  const labels = name.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  return Buffer.concat([...labels.map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])), Buffer.from([0])]);
}

function typeCode(type: string): number {
  const codes: Record<string, number> = {
    A: 1,
    NS: 2,
    SOA: 6,
    DS: 43,
    RRSIG: 46,
    NSEC3: 50,
    NSEC3PARAM: 51,
    DNSKEY: 48
  };
  const code = codes[type];

  if (!code) {
    throw new Error(`Unsupported DNS type: ${type}`);
  }

  return code;
}

function typeBitmap(types: string[]): Buffer {
  const typeCodes = [...new Set(types.map(typeCode))].sort((a, b) => a - b);
  const windows = new Map<number, number[]>();

  for (const code of typeCodes) {
    const window = Math.floor(code / 256);
    windows.set(window, [...(windows.get(window) ?? []), code % 256]);
  }

  return Buffer.concat(
    [...windows.entries()].map(([window, codes]) => {
      const length = Math.floor(Math.max(...codes) / 8) + 1;
      const bitmap = Buffer.alloc(length);

      for (const code of codes) {
        bitmap[Math.floor(code / 8)] |= 1 << (7 - (code % 8));
      }

      return Buffer.concat([Buffer.from([window, length]), bitmap]);
    })
  );
}

function uint16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
}

function uint32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function dnssecTime(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}

function dnssecTimeBuffer(value: string): Buffer {
  const date = Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14))
  );
  return uint32(Math.floor(date / 1000));
}

function derToDnsEcdsa(signature: Buffer): Buffer {
  let offset = 2;
  offset += 1;
  const rLength = signature[offset];
  offset += 1;
  const r = signature.subarray(offset, offset + rLength);
  offset += rLength;
  offset += 1;
  const sLength = signature[offset];
  offset += 1;
  const s = signature.subarray(offset, offset + sLength);
  return Buffer.concat([leftPadCoordinate(r), leftPadCoordinate(s)]);
}

function leftPadCoordinate(value: Buffer): Buffer {
  const trimmed = value.length > 32 ? value.subarray(value.length - 32) : value;
  return Buffer.concat([Buffer.alloc(32 - trimmed.length), trimmed]);
}

const base32HexAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUV";

function base32Hex(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += base32HexAlphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += base32HexAlphabet[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32HexToBuffer(value: string): Buffer {
  let bits = 0;
  let current = 0;
  const bytes: number[] = [];

  for (const char of value.toUpperCase()) {
    current = (current << 5) | base32HexAlphabet.indexOf(char);
    bits += 5;

    if (bits >= 8) {
      bytes.push((current >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}
