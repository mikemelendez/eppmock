import {
  assertCanDelete,
  assertCanUpdate,
  ObjectStatusProhibitsOperationError
} from "../epp/objectStatusPolicy.js";
import {
  ObjectAssociationProhibitsOperationError,
  type RegistryLinks
} from "../registry/registryLinks.js";
import {
  isAscii7Bit,
  isValidContactEmail,
  isValidContactId,
  isValidCountryCode,
  isValidVoiceOrFax
} from "./contactValidation.js";
import type {
  ContactPostalInfo,
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
  constructor(
    private readonly repository: ContactRepository,
    private readonly links?: RegistryLinks
  ) {}

  async checkAvailability(ids: string[]): Promise<Array<{ id: string; available: boolean }>> {
    return Promise.all(
      ids.map(async (id) => {
        if (!isValidContactId(id)) {
          return { id, available: false };
        }

        const [result] = await this.repository.checkAvailability([id]);
        return result ?? { id, available: true };
      })
    );
  }

  async create(input: CreateContactInput): Promise<ContactRecord> {
    validateCreateInput(input);

    const [availability] = await this.repository.checkAvailability([input.id]);

    if (!availability?.available) {
      throw new ContactAlreadyExistsError(input.id);
    }

    return this.repository.create({
      ...input,
      id: input.id.trim()
    });
  }

  findById(id: string): Promise<ContactRecord | null> {
    return this.repository.findById(id);
  }

  async update(id: string, registrarId: string, input: UpdateContactInput): Promise<ContactRecord> {
    const existing = await this.repository.findById(id);

    if (!existing || existing.registrarId !== registrarId) {
      throw new ContactNotFoundOrUnauthorizedError(id);
    }

    validateUpdateInput(input);
    assertCanUpdate(existing.statuses, input);

    const merged: UpdateContactInput = {
      ...input,
      postalInfo: input.postalInfo ? mergePostalInfo(existing.postalInfo, input.postalInfo) : undefined
    };
    const contact = await this.repository.update(existing.id, registrarId, merged);

    if (!contact) {
      throw new ContactNotFoundOrUnauthorizedError(id);
    }

    return contact;
  }

  async delete(id: string, registrarId: string): Promise<void> {
    const existing = await this.repository.findById(id);

    if (!existing || existing.registrarId !== registrarId) {
      throw new ContactNotFoundOrUnauthorizedError(id);
    }

    assertCanDelete(existing.statuses);

    if (await this.isLinked(existing.id)) {
      throw new ObjectAssociationProhibitsOperationError(existing.id);
    }

    const deleted = await this.repository.delete(existing.id, registrarId);

    if (!deleted) {
      throw new ContactNotFoundOrUnauthorizedError(id);
    }
  }

  list(): Promise<ContactRecord[]> {
    return this.repository.list();
  }

  reset(records?: ContactRecord[]): Promise<void> {
    return this.repository.reset(records);
  }

  private async isLinked(id: string): Promise<boolean> {
    const domains = await this.links?.domains?.list();

    if (!domains) {
      return false;
    }

    const needle = id.toLowerCase();
    return domains.some(
      (domain) =>
        domain.registrantContact?.toLowerCase() === needle ||
        domain.contacts.some((contact) => contact.id.toLowerCase() === needle)
    );
  }
}

function validateCreateInput(input: CreateContactInput): void {
  if (!isValidContactId(input.id.trim())) {
    throw new ContactValidationError("Contact id is not a valid clIDType");
  }

  if (!isValidContactEmail(input.email.trim())) {
    throw new ContactValidationError("Contact email is invalid");
  }

  if (input.postalInfo.length === 0) {
    throw new ContactValidationError("At least one postalInfo is required");
  }

  for (const postal of input.postalInfo) {
    validatePostalInfo(postal);
  }

  if (input.voice !== undefined && !isValidVoiceOrFax(input.voice)) {
    throw new ContactValidationError("Contact voice is invalid");
  }

  if (input.fax !== undefined && !isValidVoiceOrFax(input.fax)) {
    throw new ContactValidationError("Contact fax is invalid");
  }
}

function validateUpdateInput(input: UpdateContactInput): void {
  if (input.email !== undefined && !isValidContactEmail(input.email.trim())) {
    throw new ContactValidationError("Contact email is invalid");
  }

  if (input.postalInfo) {
    for (const postal of input.postalInfo) {
      validatePostalInfo(postal);
    }
  }

  if (input.voice !== undefined && input.voice !== "" && !isValidVoiceOrFax(input.voice)) {
    throw new ContactValidationError("Contact voice is invalid");
  }

  if (input.fax !== undefined && input.fax !== "" && !isValidVoiceOrFax(input.fax)) {
    throw new ContactValidationError("Contact fax is invalid");
  }
}

function validatePostalInfo(postal: ContactPostalInfo): void {
  if (postal.type !== "int" && postal.type !== "loc") {
    throw new ContactValidationError("postalInfo type must be int or loc");
  }

  if (!postal.name?.trim() || !postal.city?.trim() || !postal.cc?.trim()) {
    throw new ContactValidationError("postalInfo name, city, and cc are required");
  }

  if (!isValidCountryCode(postal.cc)) {
    throw new ContactValidationError("postalInfo cc is not a valid ISO 3166-1 alpha-2 code");
  }

  if (postal.type === "int") {
    const asciiFields = [postal.name, postal.org ?? "", postal.city, postal.sp ?? "", postal.pc ?? "", ...postal.street];

    if (asciiFields.some((field) => !isAscii7Bit(field))) {
      throw new ContactValidationError("int postalInfo must contain ASCII characters only");
    }
  }
}

function mergePostalInfo(current: ContactPostalInfo[], incoming: ContactPostalInfo[]): ContactPostalInfo[] {
  const merged = new Map(current.map((postal) => [postal.type, postal]));

  for (const postal of incoming) {
    merged.set(postal.type, postal);
  }

  return [...merged.values()];
}
