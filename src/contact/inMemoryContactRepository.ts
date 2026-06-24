import type {
  ContactRecord,
  ContactRepository,
  CreateContactInput,
  UpdateContactInput
} from "./types.js";

export class InMemoryContactRepository implements ContactRepository {
  private contacts = new Map<string, ContactRecord>();

  async checkAvailability(ids: string[]): Promise<Array<{ id: string; available: boolean }>> {
    return ids.map((id) => ({
      id,
      available: !this.contacts.has(normalizeId(id))
    }));
  }

  async create(input: CreateContactInput): Promise<ContactRecord> {
    const id = normalizeId(input.id);

    if (this.contacts.has(id)) {
      throw new Error(`Contact ${id} already exists`);
    }

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

    this.contacts.set(id, record);
    return record;
  }

  async findById(id: string): Promise<ContactRecord | null> {
    return this.contacts.get(normalizeId(id)) ?? null;
  }

  async update(id: string, registrarId: string, input: UpdateContactInput): Promise<ContactRecord | null> {
    const normalizedId = normalizeId(id);
    const contact = this.contacts.get(normalizedId);

    if (!contact || contact.registrarId !== registrarId) {
      return null;
    }

    const updated: ContactRecord = {
      ...contact,
      statuses: normalizeStatuses(
        updateList(contact.statuses, input.statusesToAdd, input.statusesToRemove)
      ),
      postalInfo: input.postalInfo ?? contact.postalInfo,
      voice: input.voice ?? contact.voice,
      fax: input.fax ?? contact.fax,
      email: input.email ?? contact.email,
      authInfo: input.authInfo ?? contact.authInfo,
      updatedAt: new Date().toISOString()
    };

    this.contacts.set(normalizedId, updated);
    return updated;
  }

  async delete(id: string, registrarId: string): Promise<boolean> {
    const normalizedId = normalizeId(id);
    const contact = this.contacts.get(normalizedId);

    if (!contact || contact.registrarId !== registrarId) {
      return false;
    }

    return this.contacts.delete(normalizedId);
  }

  async list(): Promise<ContactRecord[]> {
    return [...this.contacts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async reset(records: ContactRecord[] = []): Promise<void> {
    this.contacts.clear();

    for (const record of records) {
      this.contacts.set(normalizeId(record.id), { ...record, id: normalizeId(record.id) });
    }
  }
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
