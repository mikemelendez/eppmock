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

export function assertCanUpdate(statuses: string[], input: Record<string, unknown> = {}): void {
  if (!hasAnyStatus(statuses, UPDATE_PROHIBITED)) {
    return;
  }

  if (isProhibitionLiftUpdate(input, UPDATE_PROHIBITED)) {
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
