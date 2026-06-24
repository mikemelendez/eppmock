import type { ContactRecord } from "../contact/types.js";
import type { DomainRecord } from "../domain/types.js";
import type { HostRecord } from "../host/types.js";

export const RDAP_CONFORMANCE = [
  "rdap_level_0",
  "icann_rdap_technical_implementation_guide_0",
  "icann_rdap_response_profile_0"
];

const EPP_TO_RDAP_STATUS: Record<string, string> = {
  ok: "active",
  clientTransferProhibited: "client transfer prohibited",
  clientUpdateProhibited: "client update prohibited",
  clientDeleteProhibited: "client delete prohibited",
  clientHold: "client hold",
  serverTransferProhibited: "server transfer prohibited",
  serverUpdateProhibited: "server update prohibited",
  serverDeleteProhibited: "server delete prohibited",
  serverHold: "server hold",
  pendingTransfer: "pending transfer",
  pendingDelete: "pending delete",
  pendingCreate: "pending create",
  pendingUpdate: "pending update",
  pendingRenew: "pending renew",
  inactive: "inactive",
  redemptionPeriod: "redemption period",
  pendingRestore: "pending restore"
};

export function mapStatuses(statuses: string[]): string[] {
  return statuses.map((status) => EPP_TO_RDAP_STATUS[status] ?? status.toLowerCase());
}

export interface RdapObject {
  [key: string]: unknown;
}

export function rdapDomain(
  domain: DomainRecord,
  baseUrl: string,
  options: { unicodeName?: string } = {}
): RdapObject {
  const statuses = [...domain.statuses];

  if (domain.rgpStatus) {
    statuses.push(domain.rgpStatus);
  }

  return {
    rdapConformance: RDAP_CONFORMANCE,
    objectClassName: "domain",
    handle: `${domain.name}-EPP`,
    ldhName: domain.name,
    unicodeName: options.unicodeName,
    status: mapStatuses(statuses),
    events: [
      { eventAction: "registration", eventDate: domain.createdAt },
      ...(domain.updatedAt ? [{ eventAction: "last changed", eventDate: domain.updatedAt }] : []),
      { eventAction: "expiration", eventDate: domain.expiresAt }
    ],
    nameservers: domain.nameservers.map((nameserver) => ({
      objectClassName: "nameserver",
      ldhName: nameserver,
      links: [selfLink(`${baseUrl}/nameserver/${encodeURIComponent(nameserver)}`)]
    })),
    secureDNS: {
      delegationSigned: domain.dsRecords.length > 0,
      dsData: domain.dsRecords.map((record) => ({
        keyTag: record.keyTag,
        algorithm: record.algorithm,
        digestType: record.digestType,
        digest: record.digest
      }))
    },
    entities: [registrarEntity(domain.registrarId, baseUrl)],
    links: [selfLink(`${baseUrl}/domain/${encodeURIComponent(domain.name)}`)],
    notices: standardNotices()
  };
}

export function rdapNameserver(host: HostRecord, baseUrl: string): RdapObject {
  const v4 = host.addresses.filter((address) => address.version === "v4").map((address) => address.ip);
  const v6 = host.addresses.filter((address) => address.version === "v6").map((address) => address.ip);

  return {
    rdapConformance: RDAP_CONFORMANCE,
    objectClassName: "nameserver",
    handle: host.roid,
    ldhName: host.name,
    status: mapStatuses(host.statuses),
    ipAddresses: {
      ...(v4.length ? { v4 } : {}),
      ...(v6.length ? { v6 } : {})
    },
    events: [
      { eventAction: "registration", eventDate: host.createdAt },
      ...(host.updatedAt ? [{ eventAction: "last changed", eventDate: host.updatedAt }] : [])
    ],
    entities: [registrarEntity(host.registrarId, baseUrl)],
    links: [selfLink(`${baseUrl}/nameserver/${encodeURIComponent(host.name)}`)],
    notices: standardNotices()
  };
}

export function rdapContactEntity(contact: ContactRecord, baseUrl: string): RdapObject {
  const postal = contact.postalInfo[0];
  const vcard: unknown[] = [
    ["version", {}, "text", "4.0"],
    ["fn", {}, "text", postal?.name ?? contact.id]
  ];

  if (postal) {
    vcard.push([
      "adr",
      {},
      "text",
      ["", postal.org ?? "", postal.street.join(", "), postal.city, postal.sp ?? "", postal.pc ?? "", postal.cc]
    ]);
  }

  if (contact.voice) {
    vcard.push(["tel", { type: ["voice"] }, "uri", `tel:${contact.voice}`]);
  }

  vcard.push(["email", {}, "text", contact.email]);

  return {
    rdapConformance: RDAP_CONFORMANCE,
    objectClassName: "entity",
    handle: contact.roid,
    roles: ["registrant"],
    status: mapStatuses(contact.statuses),
    vcardArray: ["vcard", vcard],
    events: [
      { eventAction: "registration", eventDate: contact.createdAt },
      ...(contact.updatedAt ? [{ eventAction: "last changed", eventDate: contact.updatedAt }] : [])
    ],
    links: [selfLink(`${baseUrl}/entity/${encodeURIComponent(contact.id)}`)],
    notices: standardNotices()
  };
}

export function rdapRegistrarEntity(registrarId: string, baseUrl: string): RdapObject {
  return {
    rdapConformance: RDAP_CONFORMANCE,
    ...registrarEntity(registrarId, baseUrl),
    notices: standardNotices()
  };
}

export function rdapHelp(baseUrl: string): RdapObject {
  return {
    rdapConformance: RDAP_CONFORMANCE,
    notices: [
      {
        title: "RDAP Help",
        description: [
          "This is a mock RDAP service for the .melendez testing registry.",
          "Supported queries: /domain/{name}, /nameserver/{name}, /entity/{handle}, /help."
        ],
        links: [selfLink(`${baseUrl}/help`)]
      },
      ...standardNotices()
    ]
  };
}

export function rdapError(code: number, title: string, baseUrl: string, description?: string[]): RdapObject {
  return {
    rdapConformance: RDAP_CONFORMANCE,
    errorCode: code,
    title,
    description: description ?? [title],
    notices: standardNotices(baseUrl)
  };
}

function registrarEntity(registrarId: string, baseUrl: string): RdapObject {
  return {
    objectClassName: "entity",
    handle: registrarId,
    roles: ["registrar"],
    vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", registrarId]]],
    links: [selfLink(`${baseUrl}/entity/${encodeURIComponent(registrarId)}`)]
  };
}

function selfLink(href: string): RdapObject {
  return { value: href, rel: "self", href, type: "application/rdap+json" };
}

function standardNotices(_baseUrl?: string): unknown[] {
  return [
    {
      title: "Terms of Use",
      description: [
        "This RDAP service is provided for testing purposes only.",
        "Additional registration data may be available at https://lookup.icann.org."
      ]
    },
    {
      title: "Status Codes",
      description: ["For more information on domain status codes, please visit https://icann.org/epp"],
      links: [
        { value: "https://icann.org/epp", rel: "glossary", href: "https://icann.org/epp", type: "text/html" }
      ]
    }
  ];
}
