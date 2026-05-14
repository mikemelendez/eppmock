import { createHash } from "node:crypto";
import type { DomainRecord } from "../domain/types.js";
import { DnssecKeyStore } from "./dnssecKeyStore.js";
import { signZoneRecords } from "./dnssecSigner.js";
import type { DnssecKeyConfig, DnsZoneOptions, ZoneRecord } from "./types.js";

const origin = "melendez.";
const ttl = 3600;
const tldNameservers = ["ns1.melendez.", "ns2.melendez."];

export function generateMelendezZone(
  domains: DomainRecord[],
  options: DnsZoneOptions,
  keyConfig: DnssecKeyConfig
): string {
  const records = unsignedZoneRecords(domains, options.dnssec);
  const outputRecords = options.dnssec
    ? signZoneRecords(records, options, new DnssecKeyStore(keyConfig.keyPath).loadOrCreate(options.keyAction)).records
    : records;

  return renderZone(outputRecords);
}

export function unsignedZoneRecords(domains: DomainRecord[], includeDelegationDs = false): ZoneRecord[] {
  const serial = zoneSerial();
  const delegations = domains
    .filter((domain) => domain.name.endsWith(".melendez"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((domain, index) => domainDelegationRecords(domain, index, includeDelegationDs));

  return [
    { owner: "@", type: "SOA", ttl, rdata: `${tldNameservers[0]} hostmaster.${origin} ${serial} 3600 900 1209600 3600` },
    ...tldNameservers.map((nameserver) => ({ owner: "@", type: "NS", ttl, rdata: nameserver })),
    { owner: "ns1", type: "A", ttl, rdata: "192.0.2.10" },
    { owner: "ns2", type: "A", ttl, rdata: "192.0.2.11" },
    { owner: "; Delegated .melendez domains", type: "COMMENT", ttl, rdata: "" },
    ...(delegations.length ? delegations : [{ owner: "; No registered .melendez domains found", type: "COMMENT", ttl, rdata: "" }])
  ];
}

export function domainDelegationRecords(domain: DomainRecord, index: number, includeDs = false): ZoneRecord[] {
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

    if (glueOwner) {
      records.push({ owner: glueOwner, type: "A", ttl, rdata: `192.0.2.${100 + index * 2 + nameserverIndex}` });
    }
  }

  return records;
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

function zoneSerial(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}01`;
}
