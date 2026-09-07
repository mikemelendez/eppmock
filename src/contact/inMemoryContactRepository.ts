import { allocateRoid } from "../epp/roid.js";
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
      available: !this.contacts.has(normalizeLookup(id))
    }));
  }

  async create(input: CreateContactInput): Promise<ContactRecord> {
    const lookup = normalizeLookup(input.id);

    if (this.contacts.has(lookup)) {
      throw new Error(`Contact ${input.id} already exists`);
    }

    const record: ContactRecord = {
      id: input.id.trim(),
      registrarId: input.registrarId,
      creatorId: input.registrarId,
      roid: allocateRoid("C"),
      statuses: ["ok"],
      postalInfo: input.postalInfo,
      voice: input.voice,
      voiceExt: input.voiceExt,
      fax: input.fax,
      faxExt: input.faxExt,
      email: input.email,
      authInfo: input.authInfo,
      createdAt: new Date().toISOString()
    };

    this.contacts.set(lookup, record);
    return record;
  }

  async findById(id: string): Promise<ContactRecord | null> {
    return this.contacts.get(normalizeLookup(id)) ?? null;
  }

  async update(id: string, registrarId: string, input: UpdateContactInput): Promise<ContactRecord | null> {
    const lookup = normalizeLookup(id);
    const contact = this.contacts.get(lookup);

    if (!contact || contact.registrarId !== registrarId) {
      return null;
    }

    const updated: ContactRecord = {
      ...contact,
      statuses: normalizeStatuses(updateList(contact.statuses, input.statusesToAdd, input.statusesToRemove)),
      postalInfo: input.postalInfo ?? contact.postalInfo,
      voice: input.voice ?? contact.voice,
      voiceExt: input.voiceExt ?? contact.voiceExt,
      fax: input.fax ?? contact.fax,
      faxExt: input.faxExt ?? contact.faxExt,
      email: input.email ?? contact.email,
      authInfo: input.authInfo ?? contact.authInfo,
      updatedAt: new Date().toISOString()
    };

    this.contacts.set(lookup, updated);
    return updated;
  }

  async delete(id: string, registrarId: string): Promise<boolean> {
    const lookup = normalizeLookup(id);
    const contact = this.contacts.get(lookup);

    if (!contact || contact.registrarId !== registrarId) {
      return false;
    }

    return this.contacts.delete(lookup);
  }

  async list(): Promise<ContactRecord[]> {
    return [...this.contacts.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async reset(records: ContactRecord[] = []): Promise<void> {
    this.contacts.clear();

    for (const record of records) {
      this.contacts.set(normalizeLookup(record.id), {
        ...record,
        id: record.id.trim(),
        creatorId: record.creatorId ?? record.registrarId
      });
    }
  }
}

function normalizeLookup(id: string): string {
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
