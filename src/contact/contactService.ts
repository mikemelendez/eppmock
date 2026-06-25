import {
  assertCanDelete,
  assertCanUpdate,
  ObjectStatusProhibitsOperationError
} from "../epp/objectStatusPolicy.js";
import type {
  ContactRecord,
  ContactRepository,
  CreateContactInput,
  UpdateContactInput
} from "./types.js";

export { ObjectStatusProhibitsOperationError };

export class ContactValidationError extends Error {}

export class ContactAlreadyExistsError extends Error {
  constructor(id: string) {
    super(`Contact ${id} already exists`);
  }
}

export class ContactNotFoundOrUnauthorizedError extends Error {
  constructor(id: string) {
    super(`Contact ${id} not found or registrar is not authorized`);
  }
}

export class ContactService {
  constructor(private readonly repository: ContactRepository) {}

  checkAvailability(ids: string[]): Promise<Array<{ id: string; available: boolean }>> {
    return this.repository.checkAvailability(ids.map(normalizeId));
  }

  async create(input: CreateContactInput): Promise<ContactRecord> {
    if (!input.id.trim()) {
      throw new ContactValidationError("Contact id is required");
    }

    if (!input.email.trim()) {
      throw new ContactValidationError("Contact email is required");
    }

    if (input.postalInfo.length === 0) {
      throw new ContactValidationError("At least one postalInfo is required");
    }

    const [availability] = await this.repository.checkAvailability([normalizeId(input.id)]);

    if (!availability?.available) {
      throw new ContactAlreadyExistsError(normalizeId(input.id));
    }

    return this.repository.create({ ...input, id: normalizeId(input.id) });
  }

  findById(id: string): Promise<ContactRecord | null> {
    return this.repository.findById(normalizeId(id));
  }

  async update(id: string, registrarId: string, input: UpdateContactInput): Promise<ContactRecord> {
    const normalizedId = normalizeId(id);
    const existing = await this.repository.findById(normalizedId);

    if (!existing || existing.registrarId !== registrarId) {
      throw new ContactNotFoundOrUnauthorizedError(normalizedId);
    }

    assertCanUpdate(existing.statuses, input);
    const contact = await this.repository.update(normalizedId, registrarId, input);

    if (!contact) {
      throw new ContactNotFoundOrUnauthorizedError(normalizeId(id));
    }

    return contact;
  }

  async delete(id: string, registrarId: string): Promise<void> {
    const normalizedId = normalizeId(id);
    const existing = await this.repository.findById(normalizedId);

    if (!existing || existing.registrarId !== registrarId) {
      throw new ContactNotFoundOrUnauthorizedError(normalizedId);
    }

    assertCanDelete(existing.statuses);
    const deleted = await this.repository.delete(normalizedId, registrarId);

    if (!deleted) {
      throw new ContactNotFoundOrUnauthorizedError(normalizeId(id));
    }
  }

  list(): Promise<ContactRecord[]> {
    return this.repository.list();
  }

  reset(records?: ContactRecord[]): Promise<void> {
    return this.repository.reset(records);
  }
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}
