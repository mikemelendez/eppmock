import { randomUUID } from "node:crypto";
import type { HostRecord } from "../host/types.js";
import { buildEppXml } from "./xml.js";

const eppAttributes = {
  "@_xmlns": "urn:ietf:params:xml:ns:epp-1.0"
};

const hostAttributes = {
  "@_xmlns:host": "urn:ietf:params:xml:ns:host-1.0",
  "@_xsi:schemaLocation": "urn:ietf:params:xml:ns:host-1.0 host-1.0.xsd"
};

export function hostCheckResponse(
  results: Array<{ name: string; available: boolean }>,
  transactionId?: string
): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        resData: {
          "host:chkData": {
            ...hostAttributes,
            "host:cd": results.map((result) => ({
              "host:name": {
                "@_avail": result.available ? "1" : "0",
                "#text": result.name
              }
            }))
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function hostCreateResponse(host: HostRecord, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        resData: {
          "host:creData": {
            ...hostAttributes,
            "host:name": host.name,
            "host:crDate": host.createdAt
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function hostInfoResponse(host: HostRecord, transactionId?: string): string {
  return buildEppXml({
    epp: {
      ...eppAttributes,
      response: {
        result: { "@_code": 1000, msg: "Command completed successfully" },
        resData: {
          "host:infData": {
            ...hostAttributes,
            "host:name": host.name,
            "host:roid": host.roid,
            "host:status": host.statuses.map((status) => ({ "@_s": status })),
            "host:addr": host.addresses.map((address) => ({
              "@_ip": address.version,
              "#text": address.ip
            })),
            "host:clID": host.registrarId,
            "host:crID": host.registrarId,
            "host:crDate": host.createdAt,
            "host:upDate": host.updatedAt
          }
        },
        trID: { clTRID: transactionId, svTRID: randomUUID() }
      }
    }
  });
}

export function hostObjectExists(transactionId?: string): string {
  return hostErrorResponse(2302, "Object exists", transactionId);
}

export function hostObjectDoesNotExist(transactionId?: string): string {
  return hostErrorResponse(2303, "Object does not exist", transactionId);
}

export function hostNotAuthorized(transactionId?: string): string {
  return hostErrorResponse(2201, "Authorization error", transactionId);
}

export function hostParameterPolicyError(transactionId?: string): string {
  return hostErrorResponse(2005, "Parameter value policy error", transactionId);
}

function hostErrorResponse(code: number, message: string, transactionId?: string): string {
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
