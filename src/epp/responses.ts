import { randomUUID } from "node:crypto";
import { buildEppXml } from "./xml.js";

const eppAttributes = {
  "@_xmlns": "urn:ietf:params:xml:ns:epp-1.0",
  "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:epp-1.0 epp-1.0.xsd"
};

export function greeting(serverId: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      greeting: {
        svID: serverId,
        svDate: new Date().toISOString(),
        svcMenu: {
          version: "1.0",
          lang: "en",
          objURI: [
            "urn:ietf:params:xml:ns:domain-1.0",
            "urn:ietf:params:xml:ns:contact-1.0",
            "urn:ietf:params:xml:ns:host-1.0"
          ],
          svcExtension: {
            extURI: "urn:ietf:params:xml:ns:secDNS-1.1"
          }
        },
        dcp: {
          access: {
            all: ""
          },
          statement: {
            purpose: {
              admin: "",
              prov: ""
            },
            recipient: {
              ours: ""
            },
            retention: {
              stated: ""
            }
          }
        }
      }
    }
  });
}

export function resultResponse(code: number, message: string, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": code,
          msg: message
        },
        trID: {
          svTRID: transactionId ?? randomUUID()
        }
      }
    }
  });
}

export function commandCompleted(transactionId?: string): string {
  return resultResponse(1000, "Command completed successfully", transactionId);
}

export function authenticationError(transactionId?: string): string {
  return resultResponse(2200, "Authentication error", transactionId);
}

export function authorizationError(transactionId?: string): string {
  return resultResponse(2201, "Authorization error", transactionId);
}

export function syntaxError(transactionId?: string): string {
  return resultResponse(2001, "Command syntax error", transactionId);
}

export function unknownCommand(transactionId?: string): string {
  return resultResponse(2000, "Unknown command", transactionId);
}
