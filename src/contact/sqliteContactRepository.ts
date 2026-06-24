import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type {
  ContactPostalInfo,
  ContactRecord,
  ContactRepository,
  CreateContactInput,
  UpdateContactInput
} from "./types.js";

interface ContactRow {
  id: string;
  registrar_id: string;
  roid: string;
  statuses_json: string;
  postal_info_json: string;
  voice: string | null;
  fax: string | null;
  email: string;
  auth_info: string | null;
  created_at: string;
  updated_at: string | null;
}

export class SqliteContactRepository implements ContactRepository {
  private readonly db: Database.Database;

  constructor(path: string) {
    const absolutePath = resolve(path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new Database(absolutePath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  async checkAvailability(ids: string[]): Promise<Array<{ id: string; available: boolean }>> {
    const stmt = this.db.prepare("SELECT 1 FROM contacts WHERE id = ?");
    return ids.map((id) => ({ id: normalizeId(id), available: stmt.get(normalizeId(id)) === undefined }));
  }

  async create(input: CreateContactInput): Promise<ContactRecord> {
    const id = normalizeId(input.id);
    const record: ContactRecord = {
      id,
      registrarId: input.registrarId,
      roid: `${id.toUpperCase()}-EPP`,
      statuses: ["ok"],
      postalInfo: input.postalInfo,
      voice: input.voice,
      fax: input.fax,
      email: input.email,
      authInfo: input.authInfo,
      createdAt: new Date().toISOString()
    };

    this.insert(record);
    return record;
  }

  async findById(id: string): Promise<ContactRecord | null> {
    const row = this.db.prepare("SELECT * FROM contacts WHERE id = ?").get(normalizeId(id)) as ContactRow | undefined;
    return row ? mapRow(row) : null;
  }

  async update(id: string, registrarId: string, input: UpdateContactInput): Promise<ContactRecord | null> {
    const contact = await this.findById(id);

    if (!contact || contact.registrarId !== registrarId) {
      return null;
    }

    const updated: ContactRecord = {
      ...contact,
      statuses: normalizeStatuses(updateList(contact.statuses, input.statusesToAdd, input.statusesToRemove)),
      postalInfo: input.postalInfo ?? contact.postalInfo,
      voice: input.voice ?? contact.voice,
      fax: input.fax ?? contact.fax,
      email: input.email ?? contact.email,
      authInfo: input.authInfo ?? contact.authInfo,
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare(
        `UPDATE contacts SET registrar_id = ?, roid = ?, statuses_json = ?, postal_info_json = ?, voice = ?, fax = ?, email = ?, auth_info = ?, created_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(...values(updated).slice(1), updated.id);

    return updated;
  }

  async delete(id: string, registrarId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM contacts WHERE id = ? AND registrar_id = ?")
      .run(normalizeId(id), registrarId);
    return result.changes > 0;
  }

  async list(): Promise<ContactRecord[]> {
    const rows = this.db.prepare("SELECT * FROM contacts ORDER BY id ASC").all() as ContactRow[];
    return rows.map(mapRow);
  }

  async reset(records: ContactRecord[] = []): Promise<void> {
    const transaction = this.db.transaction((items: ContactRecord[]) => {
      this.db.prepare("DELETE FROM contacts").run();
      for (const record of items) {
        this.insert({ ...record, id: normalizeId(record.id) });
      }
    });
    transaction(records);
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }

  private insert(record: ContactRecord): void {
    this.db
      .prepare(
        `INSERT INTO contacts (id, registrar_id, roid, statuses_json, postal_info_json, voice, fax, email, auth_info, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...values(record));
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        registrar_id TEXT NOT NULL,
        roid TEXT NOT NULL,
        statuses_json TEXT NOT NULL,
        postal_info_json TEXT NOT NULL,
        voice TEXT,
        fax TEXT,
        email TEXT NOT NULL,
        auth_info TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_contacts_registrar_id ON contacts (registrar_id);
    `);
  }
}

function values(record: ContactRecord): [
  string,
  string,
  string,
  string,
  string,
  string | null,
  string | null,
  string,
  string | null,
  string,
  string | null
] {
  return [
    record.id,
    record.registrarId,
    record.roid,
    JSON.stringify(record.statuses),
    JSON.stringify(record.postalInfo),
    record.voice ?? null,
    record.fax ?? null,
    record.email,
    record.authInfo ?? null,
    record.createdAt,
    record.updatedAt ?? null
  ];
}

function mapRow(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    registrarId: row.registrar_id,
    roid: row.roid,
    statuses: parseStatuses(row.statuses_json),
    postalInfo: parsePostalInfo(row.postal_info_json),
    voice: row.voice ?? undefined,
    fax: row.fax ?? undefined,
    email: row.email,
    authInfo: row.auth_info ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined
  };
}

function parseStatuses(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : ["ok"];
}

function parsePostalInfo(value: string): ContactPostalInfo[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? (parsed as ContactPostalInfo[]) : [];
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

function updateList(current: string[], toAdd: string[] = [], toRemove: string[] = []): string[] {
  const removeSet = new Set(toRemove.map((value) => value.trim()));
  return [...new Set([...current.filter((value) => !removeSet.has(value)), ...toAdd])];
}

function normalizeStatuses(statuses: string[]): string[] {
  const normalized = [...new Set(statuses.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : ["ok"];
}
