import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { SqliteHostRepository } from "./sqliteHostRepository.js";

function withRepo(run: (repo: SqliteHostRepository, path: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "epp-host-sqlite-"));
    const path = join(dir, "hosts.sqlite");
    const repo = new SqliteHostRepository(path);

    try {
      await run(repo, path);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  "create stores glue addresses and normalizes the name",
  withRepo(async (repo) => {
    const created = await repo.create({
      name: "NS1.Valid.melendez.",
      registrarId: "reg-a",
      addresses: [
        { ip: "192.0.2.1", version: "v4" },
        { ip: "2001:db8::1", version: "v6" }
      ]
    });

    assert.equal(created.name, "ns1.valid.melendez");
    assert.deepEqual(created.statuses, ["ok"]);
    assert.equal(created.addresses.length, 2);

    const found = await repo.findByName("ns1.valid.melendez");
    assert.ok(found);
    assert.deepEqual(found?.addresses, [
      { ip: "192.0.2.1", version: "v4" },
      { ip: "2001:db8::1", version: "v6" }
    ]);
  })
);

test(
  "create dedupes repeated addresses",
  withRepo(async (repo) => {
    const created = await repo.create({
      name: "ns2.valid.melendez",
      registrarId: "reg-a",
      addresses: [
        { ip: "192.0.2.5", version: "v4" },
        { ip: "192.0.2.5", version: "v4" }
      ]
    });

    assert.equal(created.addresses.length, 1);
  })
);

test(
  "checkAvailability reflects existing hosts",
  withRepo(async (repo) => {
    await repo.create({ name: "ns1.taken.melendez", registrarId: "reg-a" });

    const result = await repo.checkAvailability(["ns1.taken.melendez", "ns1.free.melendez"]);
    assert.deepEqual(result, [
      { name: "ns1.taken.melendez", available: false },
      { name: "ns1.free.melendez", available: true }
    ]);
  })
);

test(
  "update adds and removes addresses and statuses",
  withRepo(async (repo) => {
    await repo.create({
      name: "ns1.valid.melendez",
      registrarId: "reg-a",
      addresses: [{ ip: "192.0.2.1", version: "v4" }]
    });

    const updated = await repo.update("ns1.valid.melendez", "reg-a", {
      addressesToAdd: [{ ip: "2001:db8::2", version: "v6" }],
      addressesToRemove: [{ ip: "192.0.2.1", version: "v4" }],
      statusesToAdd: ["clientUpdateProhibited"]
    });

    assert.ok(updated);
    assert.deepEqual(updated?.addresses, [{ ip: "2001:db8::2", version: "v6" }]);
    assert.deepEqual(updated?.statuses, ["ok", "clientUpdateProhibited"]);
  })
);

test(
  "update and delete reject a non-sponsoring registrar",
  withRepo(async (repo) => {
    await repo.create({ name: "ns1.valid.melendez", registrarId: "reg-a" });

    assert.equal(await repo.update("ns1.valid.melendez", "reg-b", { statusesToAdd: ["x"] }), null);
    assert.equal(await repo.delete("ns1.valid.melendez", "reg-b"), false);
    assert.equal(await repo.delete("ns1.valid.melendez", "reg-a"), true);
    assert.equal(await repo.findByName("ns1.valid.melendez"), null);
  })
);

test(
  "data survives reopening the database file",
  withRepo(async (repo, path) => {
    await repo.create({
      name: "ns1.persist.melendez",
      registrarId: "reg-a",
      addresses: [{ ip: "2001:db8::9", version: "v6" }]
    });
    repo.close();

    const reopened = new SqliteHostRepository(path);

    try {
      const found = await reopened.findByName("ns1.persist.melendez");
      assert.ok(found);
      assert.deepEqual(found?.addresses, [{ ip: "2001:db8::9", version: "v6" }]);
    } finally {
      reopened.close();
    }
  })
);
