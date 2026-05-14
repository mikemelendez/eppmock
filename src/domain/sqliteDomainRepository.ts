import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type {
  CreateDomainInput,
  DomainRecord,
  DomainRepository,
  TransferStatus,
  UpdateDomainInput
} from "./types.js";

interface DomainRow {
  name: string;
  registrar_id: string;
  period_years: number;
  statuses_json: string;
  nameservers_json: string | null;
  registrant_contact: string | null;
  contacts_json: string | null;
  auth_info: string | null;
  ds_records_json: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string;
  transfer_json: string | null;
}

export class SqliteDomainRepository implements DomainRepository {
  private readonly db: Database.Database;

  constructor(path: string) {
    const absolutePath = resolve(path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    this.db = new Database(absolutePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  async checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    const stmt = this.db.prepare("SELECT 1 FROM domains WHERE name = ?");

    return names.map((name) => {
      const normalizedName = normalizeDomainName(name);
      return {
        name: normalizedName,
        available: stmt.get(normalizedName) === undefined
      };
    });
  }

  async create(input: CreateDomainInput): Promise<DomainRecord> {
    const createdAt = new Date();
    const periodYears = input.periodYears ?? 1;
    const expiresAt = new Date(createdAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + periodYears);

    const record: DomainRecord = {
      name: normalizeDomainName(input.name),
      registrarId: input.registrarId,
      periodYears,
      statuses: ["ok"],
      nameservers: unique(input.nameservers ?? []),
      registrantContact: input.registrantContact,
      contacts: input.contacts ?? [],
      authInfo: input.authInfo,
      dsRecords: input.dsRecords ?? [],
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    this.insert(record);
    return record;
  }

  async findByName(name: string): Promise<DomainRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM domains WHERE name = ?")
      .get(normalizeDomainName(name)) as DomainRow | undefined;

    return row ? mapDomainRow(row) : null;
  }

  async update(name: string, registrarId: string, input: UpdateDomainInput): Promise<DomainRecord | null> {
    const domain = await this.findAuthorizedDomain(name, registrarId);

    if (!domain) {
      return null;
    }

    const updated: DomainRecord = {
      ...domain,
      nameservers: updateList(domain.nameservers, input.nameserversToAdd, input.nameserversToRemove),
      contacts: updateContacts(domain.contacts, input.contactsToAdd, input.contactsToRemove),
      statuses: normalizeStatuses(updateList(domain.statuses, input.statusesToAdd, input.statusesToRemove)),
      registrantContact: input.registrantContact ?? domain.registrantContact,
      authInfo: input.authInfo ?? domain.authInfo,
      dsRecords: updateDsRecords(domain.dsRecords, input.dsRecordsToAdd, input.dsRecordsToRemove),
      updatedAt: new Date().toISOString()
    };

    this.save(updated);
    return updated;
  }

  async delete(name: string, registrarId: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM domains WHERE name = ? AND registrar_id = ?")
      .run(normalizeDomainName(name), registrarId);

    return result.changes > 0;
  }

  async renew(name: string, registrarId: string, periodYears = 1): Promise<DomainRecord | null> {
    const domain = await this.findAuthorizedDomain(name, registrarId);

    if (!domain) {
      return null;
    }

    const expiresAt = new Date(domain.expiresAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + periodYears);

    const updated: DomainRecord = {
      ...domain,
      periodYears,
      expiresAt: expiresAt.toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.save(updated);
    return updated;
  }

  async setTransfer(
    name: string,
    operation: "request" | "approve" | "reject" | "cancel" | "query",
    registrarId: string
  ): Promise<DomainRecord | null> {
    const domain = await this.findByName(name);

    if (!domain) {
      return null;
    }

    const now = new Date().toISOString();
    const transferStatus = transferStatusFor(operation, domain.transfer?.status);
    const updated: DomainRecord = {
      ...domain,
      registrarId: transferStatus === "approved" ? registrarId : domain.registrarId,
      statuses: normalizeStatuses(
        transferStatus === "pending"
          ? [...domain.statuses, "pendingTransfer"]
          : domain.statuses.filter((status) => status !== "pendingTransfer")
      ),
      transfer: {
        status: transferStatus,
        requestedBy: domain.transfer?.requestedBy ?? registrarId,
        requestedAt: domain.transfer?.requestedAt ?? now,
        updatedAt: now
      },
      updatedAt: now
    };

    this.save(updated);
    return updated;
  }

  async list(): Promise<DomainRecord[]> {
    const rows = this.db.prepare("SELECT * FROM domains ORDER BY name ASC").all() as DomainRow[];
    return rows.map(mapDomainRow);
  }

  async reset(records: DomainRecord[] = []): Promise<void> {
    const transaction = this.db.transaction((domainRecords: DomainRecord[]) => {
      this.db.prepare("DELETE FROM domains").run();

      for (const record of domainRecords) {
        this.insert(normalizeRecord(record));
      }
    });

    transaction(records);
  }

  close(): void {
    this.db.close();
  }

  private findAuthorizedDomain(name: string, registrarId: string): Promise<DomainRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM domains WHERE name = ? AND registrar_id = ?")
      .get(normalizeDomainName(name), registrarId) as DomainRow | undefined;

    return Promise.resolve(row ? mapDomainRow(row) : null);
  }

  private insert(record: DomainRecord): void {
    this.db
      .prepare(
        `INSERT INTO domains (
          name,
          registrar_id,
          period_years,
          statuses_json,
          nameservers_json,
          registrant_contact,
          contacts_json,
          auth_info,
          ds_records_json,
          created_at,
          updated_at,
          expires_at,
          transfer_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...domainValues(record));
  }

  private save(record: DomainRecord): void {
    this.db
      .prepare(
        `UPDATE domains SET
          registrar_id = ?,
          period_years = ?,
          statuses_json = ?,
          nameservers_json = ?,
          registrant_contact = ?,
          contacts_json = ?,
          auth_info = ?,
          ds_records_json = ?,
          created_at = ?,
          updated_at = ?,
          expires_at = ?,
          transfer_json = ?
        WHERE name = ?`
      )
      .run(...domainValues(record).slice(1), record.name);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS domains (
        name TEXT PRIMARY KEY,
        registrar_id TEXT NOT NULL,
        period_years INTEGER NOT NULL,
        statuses_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_domains_registrar_id
        ON domains (registrar_id);
    `);

    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(domains)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    const migrations: Array<[string, string]> = [
      ["nameservers_json", "ALTER TABLE domains ADD COLUMN nameservers_json TEXT"],
      ["registrant_contact", "ALTER TABLE domains ADD COLUMN registrant_contact TEXT"],
      ["contacts_json", "ALTER TABLE domains ADD COLUMN contacts_json TEXT"],
      ["auth_info", "ALTER TABLE domains ADD COLUMN auth_info TEXT"],
      ["ds_records_json", "ALTER TABLE domains ADD COLUMN ds_records_json TEXT"],
      ["updated_at", "ALTER TABLE domains ADD COLUMN updated_at TEXT"],
      ["transfer_json", "ALTER TABLE domains ADD COLUMN transfer_json TEXT"]
    ];

    for (const [column, sql] of migrations) {
      if (!columns.has(column)) {
        this.db.exec(sql);
      }
    }
  }
}

function domainValues(record: DomainRecord): [
  string,
  string,
  number,
  string,
  string,
  string | null,
  string,
  string | null,
  string,
  string,
  string | null,
  string,
  string | null
] {
  return [
    record.name,
    record.registrarId,
    record.periodYears,
    JSON.stringify(record.statuses),
    JSON.stringify(record.nameservers),
    record.registrantContact ?? null,
    JSON.stringify(record.contacts),
    record.authInfo ?? null,
    JSON.stringify(record.dsRecords),
    record.createdAt,
    record.updatedAt ?? null,
    record.expiresAt,
    record.transfer ? JSON.stringify(record.transfer) : null
  ];
}

function mapDomainRow(row: DomainRow): DomainRecord {
  return normalizeRecord({
    name: row.name,
    registrarId: row.registrar_id,
    periodYears: row.period_years,
    statuses: parseStringArray(row.statuses_json, ["ok"]),
    nameservers: parseStringArray(row.nameservers_json, []),
    registrantContact: row.registrant_contact ?? undefined,
    contacts: parseContacts(row.contacts_json),
    authInfo: row.auth_info ?? undefined,
    dsRecords: parseDsRecords(row.ds_records_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    expiresAt: row.expires_at,
    transfer: parseTransfer(row.transfer_json)
  });
}

function normalizeRecord(record: DomainRecord): DomainRecord {
  return {
    ...record,
    name: normalizeDomainName(record.name),
    statuses: normalizeStatuses(record.statuses ?? ["ok"]),
    nameservers: unique(record.nameservers ?? []),
    contacts: record.contacts ?? [],
    dsRecords: record.dsRecords ?? []
  };
}

function parseStringArray(value: string | null, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }

  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : fallback;
}

function parseContacts(value: string | null): DomainRecord["contacts"] {
  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(
    (item): item is DomainRecord["contacts"][number] =>
      typeof item === "object" &&
      item !== null &&
      "id" in item &&
      "type" in item &&
      typeof item.id === "string" &&
      (item.type === "admin" || item.type === "tech" || item.type === "billing")
  );
}

function parseDsRecords(value: string | null): DomainRecord["dsRecords"] {
  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(
    (item): item is DomainRecord["dsRecords"][number] =>
      typeof item === "object" &&
      item !== null &&
      "keyTag" in item &&
      "algorithm" in item &&
      "digestType" in item &&
      "digest" in item &&
      typeof item.keyTag === "number" &&
      typeof item.algorithm === "number" &&
      typeof item.digestType === "number" &&
      typeof item.digest === "string"
  );
}

function parseTransfer(value: string | null): DomainRecord["transfer"] {
  if (!value) {
    return undefined;
  }

  const parsed = JSON.parse(value) as DomainRecord["transfer"];
  return parsed;
}

function normalizeDomainName(name: string): string {
  return name.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function updateList(current: string[], toAdd: string[] = [], toRemove: string[] = []): string[] {
  const removeSet = new Set(toRemove.map((value) => value.trim()));
  return unique([...current.filter((value) => !removeSet.has(value)), ...toAdd]);
}

function updateContacts(
  current: DomainRecord["contacts"],
  toAdd: DomainRecord["contacts"] = [],
  toRemove: DomainRecord["contacts"] = []
): DomainRecord["contacts"] {
  const removeSet = new Set(toRemove.map((contact) => `${contact.type}:${contact.id}`));
  const contactMap = new Map(
    current
      .filter((contact) => !removeSet.has(`${contact.type}:${contact.id}`))
      .map((contact) => [`${contact.type}:${contact.id}`, contact])
  );

  for (const contact of toAdd) {
    contactMap.set(`${contact.type}:${contact.id}`, contact);
  }

  return [...contactMap.values()];
}

function updateDsRecords(
  current: DomainRecord["dsRecords"],
  toAdd: DomainRecord["dsRecords"] = [],
  toRemove: DomainRecord["dsRecords"] = []
): DomainRecord["dsRecords"] {
  const removeSet = new Set(toRemove.map(dsKey));
  const dsMap = new Map(
    current.filter((record) => !removeSet.has(dsKey(record))).map((record) => [dsKey(record), record])
  );

  for (const record of toAdd) {
    dsMap.set(dsKey(record), record);
  }

  return [...dsMap.values()];
}

function dsKey(record: DomainRecord["dsRecords"][number]): string {
  return `${record.keyTag}:${record.algorithm}:${record.digestType}:${record.digest.toUpperCase()}`;
}

function normalizeStatuses(statuses: string[]): string[] {
  const normalized = unique(statuses);
  return normalized.length > 0 ? normalized : ["ok"];
}

function transferStatusFor(
  operation: "request" | "approve" | "reject" | "cancel" | "query",
  currentStatus?: TransferStatus
): TransferStatus {
  if (operation === "query") {
    return currentStatus ?? "pending";
  }

  if (operation === "request") {
    return "pending";
  }

  if (operation === "approve") {
    return "approved";
  }

  if (operation === "reject") {
    return "rejected";
  }

  return "cancelled";
}
