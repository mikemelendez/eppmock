import { randomUUID } from "node:crypto";
import type { ContactRecord } from "../contact/types.js";
import { buildEppXml } from "./xml.js";

const eppAttributes = {
  "@_xmlns": "urn:ietf:params:xml:ns:epp-1.0"
};

const contactAttributes = {
  "@_xmlns:contact": "urn:ietf:params:xml:ns:contact-1.0",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:contact-1.0 contact-1.0.xsd"
};

export function contactCheckResponse(
  results: Array<{ id: string; available: boolean }>,
  transactionId?: string
): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        resData: {
          "contact:chkData": {
            ...contactAttributes,
            "contact:cd": results.map((result) => ({
              "contact:id": {
                "@_avail": result.available ? "1" : "0",
                "#text": result.id
              }
            }))
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function contactCreateResponse(contact: ContactRecord, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        resData: {
          "contact:creData": {
            ...contactAttributes,
            "contact:id": contact.id,
            "contact:crDate": contact.createdAt
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function contactInfoResponse(contact: ContactRecord, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        resData: {
          "contact:infData": {
            ...contactAttributes,
            "contact:id": contact.id,
            "contact:roid": contact.roid,
            "contact:status": contact.statuses.map((status) => ({ "@_s": status })),
            "contact:postalInfo": contact.postalInfo.map((postal) => ({
              "@_type": postal.type,
              "contact:name": postal.name,
              "contact:org": postal.org,
              "contact:addr": {
                "contact:street": postal.street,
                "contact:city": postal.city,
                "contact:sp": postal.sp,
                "contact:pc": postal.pc,
                "contact:cc": postal.cc
              }
            })),
            "contact:voice": contact.voice,
            "contact:fax": contact.fax,
            "contact:email": contact.email,
            "contact:clID": contact.registrarId,
            "contact:crID": contact.registrarId,
            "contact:crDate": contact.createdAt,
            "contact:upDate": contact.updatedAt,
            "contact:authInfo": contact.authInfo
              ? { "contact:pw": contact.authInfo }
              : undefined
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function contactObjectExists(transactionId?: string): string {
  return contactErrorResponse(2302, "Object exists", transactionId);
}

export function contactObjectDoesNotExist(transactionId?: string): string {
  return contactErrorResponse(2303, "Object does not exist", transactionId);
}

export function contactNotAuthorized(transactionId?: string): string {
  return contactErrorResponse(2201, "Authorization error", transactionId);
}

function contactErrorResponse(code: number, message: string, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": code, msg: message },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}
