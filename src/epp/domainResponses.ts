import { randomUUID } from "node:crypto";
import type { DomainRecord } from "../domain/types.js";
import { buildEppXml } from "./xml.js";

const eppAttributes = {
  "@_xmlns": "urn:ietf:params:xml:ns:epp-1.0",
  "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance"
};

const domainAttributes = {
  "@_xmlns:domain": "urn:ietf:params:xml:ns:domain-1.0",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:domain-1.0 domain-1.0.xsd"
};

const secDnsAttributes = {
  "@_xmlns:secDNS": "urn:ietf:params:xml:ns:secDNS-1.1",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:secDNS-1.1 secDNS-1.1.xsd"
};

const rgpAttributes = {
  "@_xmlns:rgp": "urn:ietf:params:xml:ns:rgp-1.0",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:rgp-1.0 rgp-1.0.xsd"
};

const launchAttributes = {
  "@_xmlns:launch": "urn:ietf:params:xml:ns:launch-1.0",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:launch-1.0 launch-1.0.xsd"
};

export function domainCheckResponse(
  results: Array<{ name: string; available: boolean }>,
  transactionId?: string
): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": 1000,
          msg: "Command completed successfully"
        },
        resData: {
          "domain:chkData": {
            ...domainAttributes,
            "domain:cd": results.map((result) => ({
              "domain:name": {
                "@_avail": result.available ? "1" : "0",
                "#text": result.name
              }
            }))
          }
        },
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
      }
    }
  });
}

export function domainCreateResponse(domain: DomainRecord, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": 1000,
          msg: "Command completed successfully"
        },
        resData: {
          "domain:creData": {
            ...domainAttributes,
            "domain:name": domain.name,
            "domain:crDate": domain.createdAt,
            "domain:exDate": domain.expiresAt
          }
        },
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
      }
    }
  });
}

export function domainInfoResponse(
  domain: DomainRecord,
  transactionId?: string,
  options?: { includeAuthInfo?: boolean }
): string {
  const includeAuthInfo = options?.includeAuthInfo !== false;

  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": 1000,
          msg: "Command completed successfully"
        },
        resData: {
          "domain:infData": {
            ...domainAttributes,
            "domain:name": domain.name,
            "domain:roid": domain.roid,
            "domain:status": domain.statuses.map((status) => ({ "@_s": status })),
            "domain:registrant": domain.registrantContact,
            "domain:contact": domain.contacts.map((contact) => ({
              "@_type": contact.type,
              "#text": contact.id
            })),
            "domain:ns": domain.nameservers.length
              ? {
                  "domain:hostObj": domain.nameservers
                }
              : undefined,
            "domain:clID": domain.registrarId,
            "domain:crID": domain.creatorId ?? domain.registrarId,
            "domain:crDate": domain.createdAt,
            "domain:upID": domain.updatedAt ? domain.registrarId : undefined,
            "domain:upDate": domain.updatedAt,
            "domain:exDate": domain.expiresAt,
            "domain:trDate": domain.transfer?.updatedAt,
            "domain:authInfo":
              includeAuthInfo && domain.authInfo ? { "domain:pw": domain.authInfo } : undefined
          }
        },
        extension: buildInfoExtension(domain),
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
      }
    }
  });
}

function buildInfoExtension(domain: DomainRecord): Record<string, unknown> | undefined {
  const extension: Record<string, unknown> = {};
  const keyData = domain.keyData ?? [];
  const hasKeyData = keyData.length > 0;
  const hasDsData = domain.dsRecords.length > 0;

  // RFC 5910: infData is either keyData* or dsData* — never both.
  // Prefer keyData when present (epp.secDNSInterfaces=keyData); DS stays for zone publish.
  if (hasKeyData) {
    extension["secDNS:infData"] = {
      ...secDnsAttributes,
      "secDNS:keyData": keyData.map((record) => ({
        "secDNS:flags": record.flags,
        "secDNS:protocol": record.protocol,
        "secDNS:alg": record.algorithm,
        "secDNS:pubKey": record.publicKey
      }))
    };
  } else if (hasDsData) {
    extension["secDNS:infData"] = {
      ...secDnsAttributes,
      "secDNS:dsData": domain.dsRecords.map((record) => ({
        "secDNS:keyTag": record.keyTag,
        "secDNS:alg": record.algorithm,
        "secDNS:digestType": record.digestType,
        "secDNS:digest": record.digest
      }))
    };
  }

  if (domain.rgpStatus) {
    extension["rgp:infData"] = {
      ...rgpAttributes,
      "rgp:rgpStatus": { "@_s": domain.rgpStatus }
    };
  }

  return Object.keys(extension).length > 0 ? extension : undefined;
}

export function domainRestoreResponse(domain: DomainRecord, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        extension: {
          "rgp:upData": {
            ...rgpAttributes,
            "rgp:rgpStatus": { "@_s": domain.rgpStatus ?? "pendingRestore" }
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function domainLaunchCreateResponse(
  domain: Pick<DomainRecord, "name" | "createdAt" | "expiresAt">,
  phase: string,
  applicationId: string,
  transactionId?: string
): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        resData: {
          "domain:creData": {
            ...domainAttributes,
            "domain:name": domain.name,
            "domain:crDate": domain.createdAt,
            "domain:exDate": domain.expiresAt
          }
        },
        extension: {
          "launch:creData": {
            ...launchAttributes,
            "launch:phase": phase,
            "launch:applicationID": applicationId
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function domainLaunchCheckResponse(
  results: Array<{ name: string; claimKey?: string }>,
  phase: string,
  transactionId?: string
): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        extension: {
          "launch:chkData": {
            ...launchAttributes,
            "@_phase": phase,
            "launch:cd": results.map((result) => ({
              "launch:name": {
                "@_exists": result.claimKey ? "1" : "0",
                "#text": result.name
              },
              "launch:claimKey": result.claimKey
            }))
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function domainRenewResponse(domain: DomainRecord, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": 1000,
          msg: "Command completed successfully"
        },
        resData: {
          "domain:renData": {
            ...domainAttributes,
            "domain:name": domain.name,
            "domain:exDate": domain.expiresAt
          }
        },
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
      }
    }
  });
}

/** RFC 5731 trStatusType. Internal statuses stay approved/rejected/cancelled. */
export function eppTransferStatus(status: string | undefined): string {
  switch (status) {
    case "approved":
      return "clientApproved";
    case "rejected":
      return "clientRejected";
    case "cancelled":
      return "clientCancelled";
    default:
      return "pending";
  }
}

export function domainTransferResponse(domain: DomainRecord, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": 1000,
          msg: "Command completed successfully"
        },
        resData: {
          "domain:trnData": {
            ...domainAttributes,
            "domain:name": domain.name,
            "domain:trStatus": eppTransferStatus(domain.transfer?.status),
            "domain:reID": domain.transfer?.requestedBy ?? domain.registrarId,
            "domain:reDate": domain.transfer?.requestedAt ?? new Date().toISOString(),
            "domain:acID": domain.transfer?.losingRegistrar ?? domain.registrarId,
            "domain:acDate": domain.transfer?.updatedAt ?? new Date().toISOString(),
            "domain:exDate": domain.expiresAt
          }
        },
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
      }
    }
  });
}

export function objectDoesNotExist(transactionId?: string): string {
  return domainErrorResponse(2303, "Object does not exist", transactionId);
}

export function objectExists(transactionId?: string): string {
  return domainErrorResponse(2302, "Object exists", transactionId);
}

export function objectNotAuthorized(transactionId?: string): string {
  return domainErrorResponse(2201, "Authorization error", transactionId);
}

export function parameterValuePolicyError(transactionId?: string): string {
  return domainErrorResponse(2005, "Parameter value syntax error", transactionId);
}

export function requiredParameterMissing(transactionId?: string): string {
  return domainErrorResponse(2003, "Required parameter missing", transactionId);
}

export function associationProhibitsOperation(transactionId?: string): string {
  return domainErrorResponse(2305, "Object association prohibits operation", transactionId);
}

function domainErrorResponse(code: number, message: string, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": code,
          msg: message
        },
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
      }
    }
  });
}
