import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { ContactRecord } from "../contact/types.js";
import type { DomainRecord } from "../domain/types.js";
import type { HostRecord } from "../host/types.js";
import { syntheticGlueAddresses } from "../dns/melendezZone.js";
import { mapStatuses } from "./rdapMapper.js";

/** Fixed registrar block for the published RDAP registry dump. */
export const FIXED_RDAP_REGISTRAR = {
  ianaId: 9999,
  handle: "9999",
  name: "Melendez Registry"
} as const;

export interface RegistryExportNameserver {
  ldhName: string;
  ipAddresses?: {
    v4?: string[];
    v6?: string[];
  };
}

export interface RegistryExportRegistrant {
  handle: string;
  fn: string;
  email: string;
  tel: string;
  adr: [string, string, string, string, string, string, string];
}

export interface RegistryExportDomain {
  ldhName: string;
  handle: string;
  status: string[];
  registered: string;
  expires: string;
  changed: string;
  registrant: RegistryExportRegistrant;
  nameservers: RegistryExportNameserver[];
  dsData: Array<{
    keyTag: number;
    algorithm: number;
    digestType: number;
    digest: string;
  }>;
}

export interface RegistryExportDocument {
  databaseUpdated: string;
  registrar: typeof FIXED_RDAP_REGISTRAR;
  domains: RegistryExportDomain[];
}

export interface RegistryExportInput {
  domains: DomainRecord[];
  contacts?: ContactRecord[];
  hosts?: HostRecord[];
  /** Override databaseUpdated (defaults to now, UTC with Z). */
  databaseUpdated?: string;
}

/**
 * Build the registry.json document consumed by the RDAP server:
 * fixed registrar (ianaId 9999) + one object per delegated domain from EPP state.
 */
export function buildRegistryExport(input: RegistryExportInput): RegistryExportDocument {
  const contacts = new Map(
    (input.contacts ?? []).map((contact) => [contact.id.toUpperCase(), contact] as const)
  );
  const hosts = new Map(
    (input.hosts ?? []).map((host) => [host.name.toLowerCase(), host] as const)
  );
  const sorted = [...input.domains]
    .filter((domain) => domain.name.toLowerCase().endsWith(".melendez"))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    databaseUpdated: toUtcZ(input.databaseUpdated ?? new Date().toISOString()),
    registrar: FIXED_RDAP_REGISTRAR,
    domains: sorted.map((domain, index) => exportDomain(domain, index, contacts, hosts))
  };
}

export function writeRegistryExport(path: string, document: RegistryExportDocument): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export function readRegistryExport(path: string): RegistryExportDocument | null {
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf8")) as RegistryExportDocument;
}

function exportDomain(
  domain: DomainRecord,
  index: number,
  contacts: Map<string, ContactRecord>,
  hosts: Map<string, HostRecord>
): RegistryExportDomain {
  const statuses = [...domain.statuses];
  if (domain.rgpStatus) {
    statuses.push(domain.rgpStatus);
  }

  return {
    ldhName: domain.name.toLowerCase(),
    handle: domain.roid,
    status: mapStatuses(statuses),
    registered: toUtcZ(domain.createdAt),
    expires: toUtcZ(domain.expiresAt),
    changed: toUtcZ(domain.updatedAt ?? domain.createdAt),
    registrant: exportRegistrant(domain, contacts),
    nameservers: exportNameservers(domain, index, hosts),
    dsData: domain.dsRecords.map((record) => ({
      keyTag: record.keyTag,
      algorithm: record.algorithm,
      digestType: record.digestType,
      digest: record.digest.toUpperCase()
    }))
  };
}

function exportRegistrant(
  domain: DomainRecord,
  contacts: Map<string, ContactRecord>
): RegistryExportRegistrant {
  const contactId = domain.registrantContact;
  const contact = contactId ? contacts.get(contactId.toUpperCase()) : undefined;

  if (contact) {
    const postal = contact.postalInfo.find((entry) => entry.type === "int") ?? contact.postalInfo[0];
    const street = postal?.street?.[0] ?? "";
    return {
      handle: contact.id,
      fn: postal?.name ?? contact.id,
      email: contact.email,
      tel: toTelUri(contact.voice),
      adr: [
        "",
        "",
        street,
        postal?.city ?? "",
        postal?.sp ?? "",
        postal?.pc ?? "",
        (postal?.cc ?? "US").toUpperCase()
      ]
    };
  }

  const label = domain.name.replace(/\.melendez$/i, "");
  const pretty = label.charAt(0).toUpperCase() + label.slice(1);
  return {
    handle: `CTC-${label.toUpperCase()}`,
    fn: `${pretty} Registrant`,
    email: `hostmaster@${domain.name.toLowerCase()}`,
    tel: "tel:+1-202-555-0101",
    adr: ["", "", "1 Example Way", "Los Angeles", "CA", "90001", "US"]
  };
}

function exportNameservers(
  domain: DomainRecord,
  index: number,
  hosts: Map<string, HostRecord>
): RegistryExportNameserver[] {
  const nameservers = domain.nameservers.length
    ? domain.nameservers
    : [`ns1.${domain.name}`, `ns2.${domain.name}`];

  return nameservers.map((nameserver, nameserverIndex) => {
    const ldhName = nameserver.replace(/\.$/, "").toLowerCase();
    const entry: RegistryExportNameserver = { ldhName };

    if (!isInBailiwick(ldhName, domain.name)) {
      return entry;
    }

    const host = hosts.get(ldhName);
    if (host?.addresses.length) {
      const v4 = host.addresses.filter((address) => address.version === "v4").map((address) => address.ip);
      const v6 = host.addresses.filter((address) => address.version === "v6").map((address) => address.ip);
      entry.ipAddresses = {
        ...(v4.length ? { v4 } : {}),
        ...(v6.length ? { v6 } : {})
      };
      return entry;
    }

    const glue = syntheticGlueAddresses(index, nameserverIndex);
    entry.ipAddresses = { v4: [glue.a], v6: [glue.aaaa] };
    return entry;
  });
}

function isInBailiwick(nameserver: string, domainName: string): boolean {
  const ns = nameserver.toLowerCase().replace(/\.$/, "");
  const domain = domainName.toLowerCase().replace(/\.$/, "");
  return ns === domain || ns.endsWith(`.${domain}`);
}

function toTelUri(voice?: string): string {
  if (!voice) {
    return "tel:+1-202-555-0101";
  }

  if (voice.startsWith("tel:")) {
    return voice;
  }

  // EPP style +1.2025550101 → tel:+1.2025550101
  return `tel:${voice}`;
}

function toUtcZ(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.endsWith("Z") ? value : `${value}Z`;
  }
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
