import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { CreateHostInput, HostAddress, HostRecord, HostRepository, UpdateHostInput } from "./types.js";

interface HostRow {
  name: string;
  registrar_id: string;
  roid: string;
  statuses_json: string;
  addresses_json: string;
  created_at: string;
  updated_at: string | null;
}

export class SqliteHostRepository implements HostRepository {
  private readonly db: Database.Database;

  constructor(path: string) {
    const absolutePath = resolve(path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new Database(absolutePath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  async checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    const stmt = this.db.prepare("SELECT 1 FROM hosts WHERE name = ?");
    return names.map((name) => ({ name: normalizeName(name), available: stmt.get(normalizeName(name)) === undefined }));
  }

  async create(input: CreateHostInput): Promise<HostRecord> {
    const name = normalizeName(input.name);
    const record: HostRecord = {
      name,
      registrarId: input.registrarId,
      roid: `${name.toUpperCase()}-EPP`,
      statuses: ["ok"],
      addresses: dedupeAddresses(input.addresses ?? []),
      createdAt: new Date().toISOString()
    };

    this.insert(record);
    return record;
  }

  async findByName(name: string): Promise<HostRecord | null> {
    const row = this.db.prepare("SELECT * FROM hosts WHERE name = ?").get(normalizeName(name)) as HostRow | undefined;
    return row ? mapRow(row) : null;
  }

  async update(name: string, registrarId: string, input: UpdateHostInput): Promise<HostRecord | null> {
    const host = await this.findByName(name);

    if (!host || host.registrarId !== registrarId) {
      return null;
    }

    const updated: HostRecord = {
      ...host,
      addresses: updateAddresses(host.addresses, input.addressesToAdd, input.addressesToRemove),
      statuses: normalizeStatuses(updateList(host.statuses, input.statusesToAdd, input.statusesToRemove)),
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `UPDATE hosts SET registrar_id = ?, roid = ?, statuses_json = ?, addresses_json = ?, created_at = ?, updated_at = ? WHERE name = ?`
      )
      .run(...values(updated).slice(1), updated.name);

    return updated;
  }

  async delete(name: string, registrarId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM hosts WHERE name = ? AND registrar_id = ?")
      .run(normalizeName(name), registrarId);
    return result.changes > 0;
  }

  async list(): Promise<HostRecord[]> {
    const rows = this.db.prepare("SELECT * FROM hosts ORDER BY name ASC").all() as HostRow[];
    return rows.map(mapRow);
  }

  async reset(records: HostRecord[] = []): Promise<void> {
    const transaction = this.db.transaction((items: HostRecord[]) => {
      this.db.prepare("DELETE FROM hosts").run();
      for (const record of items) {
        this.insert({ ...record, name: normalizeName(record.name) });
      }
    });
    transaction(records);
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  private insert(record: HostRecord): void {
    this.db
      .prepare(
        `INSERT INTO hosts (name, registrar_id, roid, statuses_json, addresses_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...values(record));
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hosts (
        name TEXT PRIMARY KEY,
        registrar_id TEXT NOT NULL,
        roid TEXT NOT NULL,
        statuses_json TEXT NOT NULL,
        addresses_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_hosts_registrar_id ON hosts (registrar_id);
    `);
  }
}

function values(record: HostRecord): [string, string, string, string, string, string, string | null] {
  return [
    record.name,
    record.registrarId,
    record.roid,
    JSON.stringify(record.statuses),
    JSON.stringify(record.addresses),
    record.createdAt,
    record.updatedAt ?? null
  ];
}

function mapRow(row: HostRow): HostRecord {
  return {
    name: row.name,
    registrarId: row.registrar_id,
    roid: row.roid,
    statuses: parseStatuses(row.statuses_json),
    addresses: parseAddresses(row.addresses_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined
  };
}

function parseStatuses(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : ["ok"];
}

function parseAddresses(value: string): HostAddress[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(
    (item): item is HostAddress =>
      typeof item === "object" &&
      item !== null &&
      "ip" in item &&
      "version" in item &&
      typeof item.ip === "string" &&
      (item.version === "v4" || item.version === "v6")
  );
}

function normalizeName(name: string): string {
  return name.trim().replace(/\.$/, "").toLowerCase();
}

function addressKey(address: HostAddress): string {
  return `${address.version}:${address.ip.toLowerCase()}`;
}

function dedupeAddresses(addresses: HostAddress[]): HostAddress[] {
  return [...new Map(addresses.map((address) => [addressKey(address), address])).values()];
}

function updateAddresses(current: HostAddress[], toAdd: HostAddress[] = [], toRemove: HostAddress[] = []): HostAddress[] {
  const removeSet = new Set(toRemove.map(addressKey));
  const map = new Map(
    current.filter((address) => !removeSet.has(addressKey(address))).map((address) => [addressKey(address), address])
  );
  for (const address of toAdd) {
    map.set(addressKey(address), address);
  }
  return [...map.values()];
}

function updateList(current: string[], toAdd: string[] = [], toRemove: string[] = []): string[] {
  const removeSet = new Set(toRemove.map((value) => value.trim()));
  return [...new Set([...current.filter((value) => !removeSet.has(value)), ...toAdd])];
}

function normalizeStatuses(statuses: string[]): string[] {
  const normalized = [...new Set(statuses.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : ["ok"];
}
