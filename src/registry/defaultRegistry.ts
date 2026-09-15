import { createHash } from "node:crypto";
import type { ContactService } from "../contact/contactService.js";
import type { ContactPostalInfo } from "../contact/types.js";
import type { DomainService } from "../domain/domainService.js";
import type { DomainDsRecord } from "../domain/types.js";
import type { HostService } from "../host/hostService.js";

export const DEFAULT_REGISTRY_DOMAIN_NAMES = ["nic.melendez", "miguel.melendez", "example.melendez"] as const;

const REGISTRAR = "melendez-admin";

interface DefaultDomainSpec {
  name: (typeof DEFAULT_REGISTRY_DOMAIN_NAMES)[number];
  contactId: string;
  postalInfo: ContactPostalInfo[];
  email: string;
  voice: string;
  glueBase: number;
}

const DEFAULT_DOMAINS: DefaultDomainSpec[] = [
  {
    name: "nic.melendez",
    contactId: "NIC-001",
    postalInfo: [
      postal("int", "Registry Operator", "Monterrey", "NL", "64000", "MX", ["Av. Constitucion 100"])
    ],
    email: "hostmaster@nic.melendez",
    voice: "+52.8180000001",
    glueBase: 20
  },
  {
    name: "miguel.melendez",
    contactId: "MIG-001",
    postalInfo: [
      postal("loc", "Miguel Meléndez", "Monterrey", "NL", "64000", "MX", ["Av. Fundidora 1"])
    ],
    email: "miguel@example.net",
    voice: "+52.8180000002",
    glueBase: 30
  },
  {
    name: "example.melendez",
    contactId: "EXA-001",
    postalInfo: [postal("int", "Example User", "Dulles", "VA", "20166", "US", ["123 Example Dr."])],
    email: "jdoe@example.net",
    voice: "+1.7035555555",
    glueBase: 40
  }
];

export interface DefaultRegistryServices {
  domains: DomainService;
  contacts: ContactService;
  hosts: HostService;
}

/** Create nic / miguel / example with contacts, in-bailiwick glue, and DS if missing. */
export async function ensureDefaultRegistry(services: DefaultRegistryServices): Promise<void> {
  for (const spec of DEFAULT_DOMAINS) {
    await ensureContact(services.contacts, spec);
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
    await ensureHost(services.hosts, ns1, spec.glueBase);
    await ensureHost(services.hosts, ns2, spec.glueBase + 1);

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
      await services.domains.update(spec.name, REGISTRAR, {
        nameserversToAdd,
        dsRecordsToAdd: dsToAdd,
        statusesToAdd
      });
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

async function ensureHost(hosts: HostService, name: string, octet: number): Promise<void> {
  const expected = [
    { ip: `192.0.2.${octet}`, version: "v4" as const },
    { ip: `2001:db8:1::${octet}`, version: "v6" as const }
  ];
  const existing = await hosts.findByName(name);

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

  if (addressesToAdd.length) {
    await hosts.update(name, REGISTRAR, { addressesToAdd });
  }
}
