import { randomBytes } from "node:crypto";

/**
 * IANA EPP repository identifier (RFC 5730 §2.8). ICANNRST is registered for
 * ICANN RST / RSP evaluation and OT&E. Production pre/post-delegation tests
 * must use a TLD-specific IANA-registered id instead.
 */
export const DEFAULT_REPOSITORY_ID = "ICANNRST";

const ROID_PATTERN = /^(\w|_){1,80}-\w{1,8}$/;

let repositoryId = DEFAULT_REPOSITORY_ID;

export function getRepositoryId(): string {
  return repositoryId;
}

export function setRepositoryId(id: string): void {
  if (!/^\w{1,8}$/.test(id)) {
    throw new Error(`Invalid EPP repository id "${id}"; must be 1-8 XML name characters`);
  }

  repositoryId = id;
}

export function allocateRoid(prefix: "D" | "C" | "H"): string {
  const local = `${prefix}${randomBytes(6).toString("hex").toUpperCase()}`;
  const roid = `${local}-${repositoryId}`;

  if (!ROID_PATTERN.test(roid)) {
    throw new Error(`Generated ROID ${roid} does not match RFC 5730 roidType`);
  }

  return roid;
}

export function isValidRoid(value: string): boolean {
  return ROID_PATTERN.test(value);
}
