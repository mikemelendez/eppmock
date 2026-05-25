import { randomUUID } from "node:crypto";
import type { DomainRecord } from "../domain/types.js";
import { buildEppXml } from "./xml.js";

const eppAttributes = {
  "@_xmlns": "urn:ietf:params:xml:ns:epp-1.0"
};

const domainAttributes = {
  "@_xmlns:domain": "urn:ietf:params:xml:ns:domain-1.0",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:domain-1.0 domain-1.0.xsd"
};

const secDnsAttributes = {
  "@_xmlns:secDNS": "urn:ietf:params:xml:ns:secDNS-1.1",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:secDNS-1.1 secDNS-1.1.xsd"
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

export function domainInfoResponse(domain: DomainRecord, transactionId?: string): string {
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
            "domain:roid": `${domain.name}-EPP`,
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
            "domain:crID": domain.registrarId,
            "domain:crDate": domain.createdAt,
            "domain:upDate": domain.updatedAt,
            "domain:trDate": domain.transfer?.updatedAt,
            "domain:exDate": domain.expiresAt
          }
        },
        extension: domain.dsRecords.length
          ? {
              "secDNS:infData": {
                ...secDnsAttributes,
                "secDNS:dsData": domain.dsRecords.map((record) => ({
                  "secDNS:keyTag": record.keyTag,
                  "secDNS:alg": record.algorithm,
                  "secDNS:digestType": record.digestType,
                  "secDNS:digest": record.digest
                }))
              }
            }
          : undefined,
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
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
            "domain:trStatus": domain.transfer?.status ?? "pending",
            "domain:reID": domain.transfer?.requestedBy ?? domain.registrarId,
            "domain:reDate": domain.transfer?.requestedAt ?? new Date().toISOString(),
            "domain:acID": domain.registrarId,
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
  return domainErrorResponse(2005, "Parameter value policy error", transactionId);
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
