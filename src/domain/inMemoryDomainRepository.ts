import type {
  CreateDomainInput,
  DomainRecord,
  DomainRepository,
  TransferStatus,
  UpdateDomainInput
} from "./types.js";

export class InMemoryDomainRepository implements DomainRepository {
  private domains = new Map<string, DomainRecord>();

  async checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    return names.map((name) => ({
      name,
      available: !this.domains.has(normalizeDomainName(name))
    }));
  }

  async create(input: CreateDomainInput): Promise<DomainRecord> {
    const name = normalizeDomainName(input.name);

    if (this.domains.has(name)) {
      throw new Error(`Domain ${name} already exists`);
    }

    const createdAt = new Date();
    const expiresAt = new Date(createdAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + (input.periodYears ?? 1));

    const record: DomainRecord = {
      name,
      registrarId: input.registrarId,
      periodYears: input.periodYears ?? 1,
      statuses: ["ok"],
      nameservers: unique(input.nameservers ?? []),
      registrantContact: input.registrantContact,
      contacts: input.contacts ?? [],
      authInfo: input.authInfo,
      dsRecords: input.dsRecords ?? [],
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    this.domains.set(name, record);
    return record;
  }

  async findByName(name: string): Promise<DomainRecord | null> {
    return this.domains.get(normalizeDomainName(name)) ?? null;
  }

  async update(name: string, registrarId: string, input: UpdateDomainInput): Promise<DomainRecord | null> {
    const normalizedName = normalizeDomainName(name);
    const domain = this.domains.get(normalizedName);

    if (!domain || domain.registrarId !== registrarId) {
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

    this.domains.set(normalizedName, updated);
    return updated;
  }

  async delete(name: string, registrarId: string): Promise<boolean> {
    const normalizedName = normalizeDomainName(name);
    const domain = this.domains.get(normalizedName);

    if (!domain || domain.registrarId !== registrarId) {
      return false;
    }

    return this.domains.delete(normalizedName);
  }

  async renew(name: string, registrarId: string, periodYears = 1): Promise<DomainRecord | null> {
    const normalizedName = normalizeDomainName(name);
    const domain = this.domains.get(normalizedName);

    if (!domain || domain.registrarId !== registrarId) {
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

    this.domains.set(normalizedName, updated);
    return updated;
  }

  async setTransfer(
    name: string,
    operation: "request" | "approve" | "reject" | "cancel" | "query",
    registrarId: string
  ): Promise<DomainRecord | null> {
    const normalizedName = normalizeDomainName(name);
    const domain = this.domains.get(normalizedName);

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

    this.domains.set(normalizedName, updated);
    return updated;
  }

  async list(): Promise<DomainRecord[]> {
    return [...this.domains.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async reset(records: DomainRecord[] = []): Promise<void> {
    this.domains.clear();

    for (const record of records) {
      this.domains.set(normalizeDomainName(record.name), {
        ...record,
        name: normalizeDomainName(record.name),
        statuses: normalizeStatuses(record.statuses),
        nameservers: unique(record.nameservers ?? []),
        contacts: record.contacts ?? [],
        dsRecords: record.dsRecords ?? []
      });
    }
  }
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
