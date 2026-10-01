import { createHash } from "node:crypto";
import type { ContactService } from "../contact/contactService.js";
import type { ContactPostalInfo } from "../contact/types.js";
import type { DomainService } from "../domain/domainService.js";
import type { DomainDsRecord } from "../domain/types.js";
import type { HostAddress } from "../host/types.js";
import type { HostService } from "../host/hostService.js";
import {
  DEFAULT_TLD_NAMESERVER_CONFIG,
  resolveTldNameserverAddresses,
  type TldNameserverConfig
} from "../dns/tldNameservers.js";

export const DEFAULT_REGISTRY_DOMAIN_NAMES = ["nic.melendez", "miguel.melendez", "example.melendez"] as const;

/**
 * Sample contacts for RST `epp.registeredContacts` (check must return 1000 / avail=0).
 * Includes the common misconfigured 17-char ids (`melendez-contact1/2`) so existing
 * RST input keeps working; prefer ≤16-char ids (`melendez-ct1/2`) for new configs.
 */
export const DEFAULT_RST_REGISTERED_CONTACT_IDS = [
  "melendez-ct1",
  "melendez-ct2",
  "melendez-contact1",
  "melendez-contact2"
] as const;

const REGISTRAR = "melendez-admin";

interface DefaultDomainSpec {
  name: (typeof DEFAULT_REGISTRY_DOMAIN_NAMES)[number];
  contactId: string;
  postalInfo: ContactPostalInfo[];
  email: string;
  voice: string;
}

const DEFAULT_DOMAINS: DefaultDomainSpec[] = [
  {
    name: "nic.melendez",
    contactId: "NIC-001",
    postalInfo: [
      postal("int", "Registry Operator", "Monterrey", "NL", "64000", "MX", ["Av. Constitucion 100"])
    ],
    email: "hostmaster@nic.melendez",
    voice: "+52.8180000001"
  },
  {
    name: "miguel.melendez",
    contactId: "MIG-001",
    postalInfo: [
      postal("loc", "Miguel Meléndez", "Monterrey", "NL", "64000", "MX", ["Av. Fundidora 1"])
    ],
    email: "miguel@example.net",
    voice: "+52.8180000002"
  },
  {
    name: "example.melendez",
    contactId: "EXA-001",
    postalInfo: [postal("int", "Example User", "Dulles", "VA", "20166", "US", ["123 Example Dr."])],
    email: "jdoe@example.net",
    voice: "+1.7035555555"
  }
];

export interface DefaultRegistryServices {
  domains: DomainService;
  contacts: ContactService;
  hosts: HostService;
  /** Dual-stack glue used for seeded in-bailiwick ns1/ns2 hosts. */
  nameserverConfig?: TldNameserverConfig;
}

/** Create nic / miguel / example with contacts, in-bailiwick glue, and DS if missing. */
export async function ensureDefaultRegistry(services: DefaultRegistryServices): Promise<void> {
  const nameserverConfig = services.nameserverConfig ?? DEFAULT_TLD_NAMESERVER_CONFIG;

  await ensureRstRegisteredContacts(services.contacts);

  for (const spec of DEFAULT_DOMAINS) {
    await ensureContact(services.contacts, spec);
    const current = await services.domains.findByName(spec.name);

    if (current && current.registrarId !== REGISTRAR) {
      await services.domains.reclaimSponsor(spec.name, REGISTRAR);
    }

    await services.domains.ensureRegistered({
      name: spec.name,
      registrarId: REGISTRAR,
      periodYears: 10,
      registrantContact: spec.contactId,
      contacts: [
        { type: "admin", id: spec.contactId },
        { type: "tech", id: spec.contactId }
      ],
      authInfo: "domain-secret",
      dsRecords: [stableDs(spec.name)]
    });

    const ns1 = `ns1.${spec.name}`;
    const ns2 = `ns2.${spec.name}`;
    await ensureHost(services.hosts, ns1, "ns1", nameserverConfig);
    await ensureHost(services.hosts, ns2, "ns2", nameserverConfig);

    const domain = await services.domains.findByName(spec.name);

    if (!domain) {
      continue;
    }

    const nameserversToAdd = [ns1, ns2].filter(
      (nameserver) => !domain.nameservers.some((existing) => existing.toLowerCase() === nameserver)
    );
    const dsToAdd = domain.dsRecords.length ? [] : [stableDs(spec.name)];
    const statusesToAdd = ["serverDeleteProhibited", "serverTransferProhibited"].filter(
      (status) => !domain.statuses.includes(status)
    );

    if (nameserversToAdd.length || dsToAdd.length || statusesToAdd.length) {
      await services.domains.update(
        spec.name,
        REGISTRAR,
        {
          nameserversToAdd,
          dsRecordsToAdd: dsToAdd,
          statusesToAdd
        },
        { allowServerStatuses: true }
      );
    }
  }
}

function postal(
  type: "int" | "loc",
  name: string,
  city: string,
  sp: string,
  pc: string,
  cc: string,
  street: string[]
): ContactPostalInfo {
  return { type, name, org: "Melendez Registry", street, city, sp, pc, cc };
}

function stableDs(name: string): DomainDsRecord {
  const digest = createHash("sha256").update(`ds:${name}`).digest("hex").toUpperCase();
  const keyTag = createHash("sha256").update(`keytag:${name}`).digest().readUInt16BE(0);
  return { keyTag, algorithm: 13, digestType: 2, digest };
}

async function ensureContact(contacts: ContactService, spec: DefaultDomainSpec): Promise<void> {
  if (await contacts.findById(spec.contactId)) {
    return;
  }

  await contacts.create({
    id: spec.contactId,
    registrarId: REGISTRAR,
    postalInfo: spec.postalInfo,
    email: spec.email,
    voice: spec.voice,
    authInfo: "contact-secret"
  });
}

/** Seed RST `epp.registeredContacts` ids (avail=0), including overlong legacy ids. */
async function ensureRstRegisteredContacts(contacts: ContactService): Promise<void> {
  for (const id of DEFAULT_RST_REGISTERED_CONTACT_IDS) {
    await contacts.ensureSeeded({
      id,
      registrarId: REGISTRAR,
      postalInfo: [postal("int", "RST Sample Contact", "Monterrey", "NL", "64000", "MX", ["Av. RST 1"])],
      // Local-part must stay ≤64; overlong ids use a short mailbox.
      email: `rst-${id.slice(0, 12)}@nic.melendez`,
      voice: "+52.8180000099",
      authInfo: "contact-secret"
    });
  }
}

async function ensureHost(
  hosts: HostService,
  name: string,
  role: "ns1" | "ns2",
  nameserverConfig: TldNameserverConfig
): Promise<void> {
  const nameserver = resolveTldNameserverAddresses(nameserverConfig).find((entry) => entry.owner === role);

  if (!nameserver) {
    throw new Error(`Missing TLD nameserver addresses for ${role}`);
  }

  const expected: HostAddress[] = [
    { ip: nameserver.a, version: "v4" },
    { ip: nameserver.aaaa, version: "v6" }
  ];
  const existing = await hosts.findByName(name);

  if (existing && existing.registrarId !== REGISTRAR) {
    await hosts.reclaimSponsor(name, REGISTRAR);
  }

  if (!existing) {
    await hosts.create({
      name,
      registrarId: REGISTRAR,
      addresses: expected
    });
    return;
  }

  const addressesToAdd = expected.filter(
    (address) =>
      !existing.addresses.some((current) => current.ip === address.ip && current.version === address.version)
  );
  const addressesToRemove = existing.addresses.filter(
    (address) => !expected.some((wanted) => wanted.ip === address.ip && wanted.version === address.version)
  );

  if (addressesToAdd.length || addressesToRemove.length) {
    await hosts.update(name, REGISTRAR, { addressesToAdd, addressesToRemove });
  }
}
