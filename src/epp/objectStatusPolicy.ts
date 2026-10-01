/** RFC 5730 result code 2304 — object status prohibits the requested operation. */

export class ObjectStatusProhibitsOperationError extends Error {
  constructor(readonly operation: string) {
    super(`Object status prohibits ${operation}`);
  }
}

const UPDATE_PROHIBITED = new Set(["clientUpdateProhibited", "serverUpdateProhibited"]);
const DELETE_PROHIBITED = new Set(["clientDeleteProhibited", "serverDeleteProhibited"]);
const TRANSFER_PROHIBITED = new Set(["clientTransferProhibited", "serverTransferProhibited"]);

function hasAnyStatus(statuses: string[], blocked: Set<string>): boolean {
  return statuses.some((status) => blocked.has(status));
}

/** True when the update only removes update-prohibition statuses and makes no other changes. */
function isProhibitionLiftUpdate(input: Record<string, unknown>, prohibited: Set<string>): boolean {
  const adds = (input.statusesToAdd as string[] | undefined) ?? [];

  if (adds.length > 0) {
    return false;
  }

  const removes = (input.statusesToRemove as string[] | undefined) ?? [];
  const liftsProhibition = removes.some((status) => prohibited.has(status));

  if (!liftsProhibition) {
    return false;
  }

  for (const [key, value] of Object.entries(input)) {
    if (key === "statusesToAdd" || key === "statusesToRemove" || key === "rgpStatus") {
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      continue;
    }

    return false;
  }

  return true;
}

export function assertCanUpdate(statuses: string[], input: object = {}): void {
  if (!hasAnyStatus(statuses, UPDATE_PROHIBITED)) {
    return;
  }

  if (isProhibitionLiftUpdate(input as Record<string, unknown>, UPDATE_PROHIBITED)) {
    return;
  }

  throw new ObjectStatusProhibitsOperationError("update");
}

export function assertCanDelete(statuses: string[]): void {
  if (hasAnyStatus(statuses, DELETE_PROHIBITED) || statuses.includes("pendingDelete")) {
    throw new ObjectStatusProhibitsOperationError("delete");
  }
}

export function assertCanTransferRequest(statuses: string[]): void {
  if (
    hasAnyStatus(statuses, TRANSFER_PROHIBITED) ||
    statuses.includes("pendingDelete") ||
    statuses.includes("pendingTransfer")
  ) {
    throw new ObjectStatusProhibitsOperationError("transfer");
  }
}

export function assertCanRenew(statuses: string[]): void {
  if (statuses.includes("pendingDelete")) {
    throw new ObjectStatusProhibitsOperationError("renew");
  }
}

/** Statuses a client may add or remove on domain:update (RFC 5731 §2.3). */
export const CLIENT_SETTABLE_DOMAIN_STATUSES = new Set([
  "clientDeleteProhibited",
  "clientHold",
  "clientRenewProhibited",
  "clientTransferProhibited",
  "clientUpdateProhibited"
]);

/** Statuses a client may add or remove on host:update (RFC 5732 §2.3). */
export const CLIENT_SETTABLE_HOST_STATUSES = new Set(["clientDeleteProhibited", "clientUpdateProhibited"]);

/**
 * RFC 5731/5732/5733: status "ok" is present only when no other status is set.
 * Adding a status replaces ok; removing the last other status restores ok.
 */
export function normalizeObjectStatuses(statuses: string[]): string[] {
  const normalized = [...new Set(statuses.map((value) => value.trim()).filter(Boolean))];
  const withoutOk = normalized.filter((status) => status !== "ok");
  return withoutOk.length > 0 ? withoutOk : ["ok"];
}

/** Reject add of a status already set and rem of a status that is not set. */
export function assertStatusDelta(
  current: string[],
  toAdd: string[] | undefined,
  toRemove: string[] | undefined
): void {
  const present = new Set(current);

  for (const status of toAdd ?? []) {
    if (present.has(status)) {
      throw new ObjectStatusProhibitsOperationError("update");
    }
  }

  for (const status of toRemove ?? []) {
    if (!present.has(status)) {
      throw new ObjectStatusProhibitsOperationError("update");
    }
  }
}
