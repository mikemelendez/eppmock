import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanDelete,
  assertCanRenew,
  assertCanTransferRequest,
  assertCanUpdate,
  ObjectStatusProhibitsOperationError
} from "./objectStatusPolicy.js";

test("update is blocked by clientUpdateProhibited unless lifting the prohibition", () => {
  const statuses = ["ok", "clientUpdateProhibited"];

  assert.throws(
    () => assertCanUpdate(statuses, { statusesToAdd: ["clientTransferProhibited"] }),
    ObjectStatusProhibitsOperationError
  );

  assert.doesNotThrow(() => assertCanUpdate(statuses, { statusesToRemove: ["clientUpdateProhibited"] }));
});

test("delete is blocked by clientDeleteProhibited and pendingDelete", () => {
  assert.throws(() => assertCanDelete(["clientDeleteProhibited"]), ObjectStatusProhibitsOperationError);
  assert.throws(() => assertCanDelete(["pendingDelete"]), ObjectStatusProhibitsOperationError);
  assert.doesNotThrow(() => assertCanDelete(["ok"]));
});

test("transfer request is blocked by transfer prohibitions and pending states", () => {
  assert.throws(() => assertCanTransferRequest(["clientTransferProhibited"]), ObjectStatusProhibitsOperationError);
  assert.throws(() => assertCanTransferRequest(["pendingTransfer"]), ObjectStatusProhibitsOperationError);
  assert.doesNotThrow(() => assertCanTransferRequest(["ok"]));
});

test("renew is blocked while pendingDelete", () => {
  assert.throws(() => assertCanRenew(["pendingDelete"]), ObjectStatusProhibitsOperationError);
  assert.doesNotThrow(() => assertCanRenew(["ok"]));
});
