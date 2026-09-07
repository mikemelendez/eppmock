import { isIP } from "node:net";
import type { HostAddress } from "./types.js";

/**
 * Glue records must be real public addresses. RST epp-11 / epp-13 reject
 * loopback, unspecified, multicast, and link-local values (e.g. 127.0.0.1, ::, ::1).
 */
export function isUsableGlueAddress(ip: string, version: "v4" | "v6"): boolean {
  const detected = isIP(ip);

  if ((version === "v4" && detected !== 4) || (version === "v6" && detected !== 6)) {
    return false;
  }

  if (version === "v4") {
    const octets = ip.split(".").map(Number);
    const [a, b] = octets;

    if (a === 0 || a === 127 || a >= 224) {
      return false;
    }

    if (a === 169 && b === 254) {
      return false;
    }

    return true;
  }

  const normalized = ip.toLowerCase();

  if (normalized === "::" || normalized === "::1") {
    return false;
  }

  if (normalized.startsWith("fe80:") || normalized.startsWith("ff")) {
    return false;
  }

  return true;
}

export function assertUsableGlueAddresses(addresses: HostAddress[]): void {
  for (const address of addresses) {
    if (!isUsableGlueAddress(address.ip, address.version)) {
      throw new Error(`Invalid glue address ${address.ip}`);
    }
  }
}
