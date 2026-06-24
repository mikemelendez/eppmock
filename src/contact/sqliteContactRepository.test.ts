import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { SqliteContactRepository } from "./sqliteContactRepository.js";
import type { ContactPostalInfo } from "./types.js";

function postalInfo(name: string): ContactPostalInfo[] {
  return [
    {
      type: "int",
      name,
      street: ["1 Main St"],
      city: "Monterrey",
      cc: "MX"
    }
  ];
}

function withRepo(run: (repo: SqliteContactRepository, path: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "epp-contact-sqlite-"));
    const path = join(dir, "contacts.sqlite");
    const repo = new SqliteContactRepository(path);

    try {
      await run(repo, path);
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test(
  "create persists a contact and findById normalizes the id",
  withRepo(async (repo) => {
    const created = await repo.create({
      id: "Contact-1",
      registrarId: "reg-a",
      postalInfo: postalInfo("Ada Lovelace"),
      email: "ada@example.com",
      voice: "+52.8112345678",
      authInfo: "secret"
    });

    assert.equal(created.id, "contact-1");
    assert.deepEqual(created.statuses, ["ok"]);
    assert.equal(created.roid, "CONTACT-1-EPP");

    const found = await repo.findById("CONTACT-1");
    assert.ok(found);
    assert.equal(found?.email, "ada@example.com");
    assert.equal(found?.voice, "+52.8112345678");
    assert.equal(found?.authInfo, "secret");
    assert.equal(found?.postalInfo[0]?.name, "Ada Lovelace");
  })
);

test(
  "checkAvailability reflects existing contacts",
  withRepo(async (repo) => {
    await repo.create({ id: "taken", registrarId: "reg-a", postalInfo: postalInfo("Taken"), email: "t@example.com" });

    const result = await repo.checkAvailability(["taken", "free"]);
    assert.deepEqual(result, [
      { id: "taken", available: false },
      { id: "free", available: true }
    ]);
  })
);

test(
  "update changes mutable fields and rejects a non-sponsoring registrar",
  withRepo(async (repo) => {
    await repo.create({ id: "c1", registrarId: "reg-a", postalInfo: postalInfo("Original"), email: "old@example.com" });

    const wrongRegistrar = await repo.update("c1", "reg-b", { email: "new@example.com" });
    assert.equal(wrongRegistrar, null);

    const updated = await repo.update("c1", "reg-a", {
      email: "new@example.com",
      statusesToAdd: ["clientUpdateProhibited"]
    });

    assert.ok(updated);
    assert.equal(updated?.email, "new@example.com");
    assert.deepEqual(updated?.statuses, ["ok", "clientUpdateProhibited"]);
    assert.ok(updated?.updatedAt);
  })
);

test(
  "delete only succeeds for the sponsoring registrar",
  withRepo(async (repo) => {
    await repo.create({ id: "c1", registrarId: "reg-a", postalInfo: postalInfo("Owner"), email: "o@example.com" });

    assert.equal(await repo.delete("c1", "reg-b"), false);
    assert.equal(await repo.delete("c1", "reg-a"), true);
    assert.equal(await repo.findById("c1"), null);
  })
);

test(
  "data survives reopening the database file",
  withRepo(async (repo, path) => {
    await repo.create({ id: "persist", registrarId: "reg-a", postalInfo: postalInfo("Persist"), email: "p@example.com" });
    repo.close();

    const reopened = new SqliteContactRepository(path);

    try {
      const found = await reopened.findById("persist");
      assert.ok(found);
      assert.equal(found?.email, "p@example.com");
    } finally {
      reopened.close();
    }
  })
);
