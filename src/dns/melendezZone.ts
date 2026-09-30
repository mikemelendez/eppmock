import { createHash } from "node:crypto";
import type { DomainRecord } from "../domain/types.js";
import type { HostRecord } from "../host/types.js";
import { DnssecKeyStore } from "./dnssecKeyStore.js";
import { signZoneRecords } from "./dnssecSigner.js";
import {
  DEFAULT_TLD_NAMESERVER_CONFIG,
  resolveTldNameserverAddresses,
  type TldNameserverConfig
} from "./tldNameservers.js";
import type { DnssecKeyConfig, DnsZoneOptions, ZoneRecord } from "./types.js";

const origin = "melendez.";
const ttl = 3600;
const tldNameservers = ["ns1.melendez.", "ns2.melendez."];

export function generateMelendezZone(
  domains: DomainRecord[],
  options: DnsZoneOptions,
  keyConfig: DnssecKeyConfig,
  hosts: HostRecord[] = [],
  nameserverConfig: TldNameserverConfig = DEFAULT_TLD_NAMESERVER_CONFIG
): string {
  const records = unsignedZoneRecords(domains, options.dnssec, hosts, nameserverConfig);
  const outputRecords = options.dnssec
    ? signZoneRecords(records, options, new DnssecKeyStore(keyConfig.keyPath).loadOrCreate(options.keyAction)).records
    : records;

  return renderZone(outputRecords);
}

export function unsignedZoneRecords(
  domains: DomainRecord[],
  includeDelegationDs = false,
  hosts: HostRecord[] = [],
  nameserverConfig: TldNameserverConfig = DEFAULT_TLD_NAMESERVER_CONFIG
): ZoneRecord[] {
  const serial = zoneSerial();
  const hostGlue = buildHostGlueMap(hosts);
  const delegations = domains
    .filter((domain) => domain.name.endsWith(".melendez"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((domain, index) => domainDelegationRecords(domain, index, includeDelegationDs, hostGlue));
  const tldNameserverGlue: ZoneRecord[] = resolveTldNameserverAddresses(nameserverConfig).flatMap((nameserver) => [
    { owner: nameserver.owner, type: "A", ttl, rdata: nameserver.a },
    { owner: nameserver.owner, type: "AAAA", ttl, rdata: nameserver.aaaa }
  ]);

  return [
    {
      owner: "@",
      type: "SOA",
      ttl,
      rdata: `${nameserverConfig.soaMname} ${nameserverConfig.soaRname} ${serial} 3600 900 1209600 3600`
    },
    ...tldNameservers.map((nameserver) => ({ owner: "@", type: "NS", ttl, rdata: nameserver })),
    ...tldNameserverGlue,
    { owner: "; Delegated .melendez domains", type: "COMMENT", ttl, rdata: "" },
    ...(delegations.length ? delegations : [{ owner: "; No registered .melendez domains found", type: "COMMENT", ttl, rdata: "" }])
  ];
}

export function domainDelegationRecords(
  domain: DomainRecord,
  index: number,
  includeDs = false,
  hostGlue: Map<string, ZoneRecord[]> = new Map()
): ZoneRecord[] {
  const label = domain.name.replace(/\.melendez$/, "");
  const nameservers = domain.nameservers.length
    ? domain.nameservers.map(ensureTrailingDot)
    : [`ns1.${domain.name}.`, `ns2.${domain.name}.`];
  const records: ZoneRecord[] = [
    { owner: `; ${domain.name}`, type: "COMMENT", ttl, rdata: "" },
    ...nameservers.map((nameserver) => ({ owner: label, type: "NS", ttl, rdata: nameserver })),
    ...(includeDs
      ? childDsRecords(domain, index).map((record) => ({
          owner: label,
          type: "DS",
          ttl,
          rdata: `${record.keyTag} ${record.algorithm} ${record.digestType} ${record.digest.toUpperCase()}`
        }))
      : [])
  ];

  for (const [nameserverIndex, nameserver] of nameservers.entries()) {
    const glueOwner = inBailiwickOwner(nameserver);

    if (!glueOwner) {
      continue;
    }

    const hostRecords = hostGlue.get(nameserver.toLowerCase().replace(/\.$/, ""));

    if (hostRecords && hostRecords.length > 0) {
      for (const hostRecord of hostRecords) {
        records.push({ owner: glueOwner, type: hostRecord.type, ttl, rdata: hostRecord.rdata });
      }
    } else {
      const glue = syntheticGlueAddresses(index, nameserverIndex);
      records.push({ owner: glueOwner, type: "A", ttl, rdata: glue.a });
      records.push({ owner: glueOwner, type: "AAAA", ttl, rdata: glue.aaaa });
    }
  }

  return records;
}

function buildHostGlueMap(hosts: HostRecord[]): Map<string, ZoneRecord[]> {
  const map = new Map<string, ZoneRecord[]>();

  for (const host of hosts) {
    const key = host.name.toLowerCase().replace(/\.$/, "");
    const records = host.addresses.map((address) => ({
      owner: key,
      type: address.version === "v6" ? "AAAA" : "A",
      ttl,
      rdata: address.ip
    }));

    if (records.length > 0) {
      map.set(key, records);
    }
  }

  return map;
}

function childDsRecords(domain: DomainRecord, index: number): DomainRecord["dsRecords"] {
  return domain.dsRecords.length ? domain.dsRecords : [syntheticDsRecord(domain, index)];
}

function renderZone(records: ZoneRecord[]): string {
  const lines = ["$ORIGIN melendez.", "$TTL 3600"];

  for (const record of records) {
    if (record.type === "COMMENT") {
      lines.push("", record.rdata ? `${record.owner}: ${record.rdata}` : record.owner);
      continue;
    }

    if (record.type === "SOA") {
      const [mname, rname, serial, refresh, retry, expire, minimum] = record.rdata.split(/\s+/);
      lines.push(
        `${displayOwner(record.owner)} IN SOA ${mname} ${rname} (`,
        `  ${serial} ; serial`,
        `  ${refresh}       ; refresh`,
        `  ${retry}        ; retry`,
        `  ${expire}    ; expire`,
        `  ${minimum}       ; minimum`,
        ")",
        ""
      );
      continue;
    }

    lines.push(`${displayOwner(record.owner)} IN ${record.type} ${record.rdata}`);
  }

  return `${lines.join("\n")}\n`;
}

function displayOwner(owner: string): string {
  return owner === "@" ? "@" : owner;
}

function syntheticDsRecord(domain: DomainRecord, index: number): DomainRecord["dsRecords"][number] {
  const digest = createHash("sha256").update(`${domain.name}:${index}`).digest("hex").toUpperCase();
  return {
    keyTag: 20000 + index,
    algorithm: 13,
    digestType: 2,
    digest
  };
}

/**
 * Documentation-range glue that stays valid for large registries.
 * Slot 0 keeps 192.0.2.100 / 2001:db8:1::64 (legacy 100 offset, hex hextet).
 */
export function syntheticGlueAddresses(
  index: number,
  nameserverIndex: number
): { a: string; aaaa: string } {
  const id = 100 + index * 2 + nameserverIndex;
  const a =
    id <= 255
      ? `192.0.2.${id}`
      : `198.18.${(id >>> 8) & 0xff}.${id & 0xff}`;
  const high = (id >>> 16) & 0xffff;
  const low = id & 0xffff;
  const aaaa =
    high === 0
      ? `2001:db8:1::${low.toString(16)}`
      : `2001:db8:1:${high.toString(16)}::${low.toString(16)}`;
  return { a, aaaa };
}

function ensureTrailingDot(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function inBailiwickOwner(nameserver: string): string | null {
  const normalized = nameserver.toLowerCase();

  if (!normalized.endsWith(".melendez.")) {
    return null;
  }

  return normalized.replace(/\.melendez\.$/, "");
}

/** YYYYMMDDHH (UTC) — bumps when nameservers move later the same day. */
function zoneSerial(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  return `${year}${month}${day}${hour}`;
}
