import { randomUUID } from "node:crypto";
import { buildEppXml } from "./xml.js";

const eppAttributes = {
  "@_xmlns": "urn:ietf:params:xml:ns:epp-1.0",
  "@_xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:epp-1.0 epp-1.0.xsd"
};

export const supportedObjectUris = [
  "urn:ietf:params:xml:ns:domain-1.0",
  "urn:ietf:params:xml:ns:contact-1.0",
  "urn:ietf:params:xml:ns:host-1.0"
];

export const supportedExtensionUris = [
  "urn:ietf:params:xml:ns:secDNS-1.1",
  "urn:ietf:params:xml:ns:rgp-1.0",
  "urn:ietf:params:xml:ns:launch-1.0"
];

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
          objURI: supportedObjectUris,
          svcExtension: {
            extURI: supportedExtensionUris
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
          clTRID: transactionId,
          svTRID: randomUUID()
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

export function unimplementedProtocolVersion(transactionId?: string): string {
  return resultResponse(2100, "Unimplemented protocol version", transactionId);
}

export function unimplementedOption(transactionId?: string): string {
  return resultResponse(2102, "Unimplemented option", transactionId);
}

export function unimplementedObjectService(transactionId?: string): string {
  return resultResponse(2307, "Unimplemented object service", transactionId);
}

export function objectStatusProhibitsOperation(transactionId?: string): string {
  return resultResponse(2304, "Object status prohibits operation", transactionId);
}

export function pollNoMessages(transactionId?: string): string {
  return resultResponse(1300, "Command completed successfully; no messages", transactionId);
}

export interface PollMessageView {
  id: string;
  enqueuedAt: string;
  text: string;
  remaining: number;
  resData?: Record<string, unknown>;
}

export function pollMessageResponse(message: PollMessageView, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": 1301,
          msg: "Command completed successfully; ack to dequeue"
        },
        msgQ: {
          "@_count": message.remaining,
          "@_id": message.id,
          qDate: message.enqueuedAt,
          msg: message.text
        },
        resData: message.resData,
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
      }
    }
  });
}

export function pollAckResponse(messageId: string, remaining: number, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: {
          "@_code": 1000,
          msg: "Command completed successfully"
        },
        msgQ: {
          "@_count": remaining,
          "@_id": messageId
        },
        trID: {
          clTRID: transactionId,
          svTRID: randomUUID()
        }
      }
    }
  });
}
