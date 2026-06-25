import { canonicalHostName, RegistryPolicyError } from "../domain/registryPolicy.js";
import {
  assertCanDelete,
  assertCanUpdate,
  ObjectStatusProhibitsOperationError
} from "../epp/objectStatusPolicy.js";
import type { CreateHostInput, HostRecord, HostRepository, UpdateHostInput } from "./types.js";

export { ObjectStatusProhibitsOperationError };

export class HostValidationError extends Error {}

export class HostAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`Host ${name} already exists`);
  }
}

export class HostNotFoundOrUnauthorizedError extends Error {
  constructor(name: string) {
    super(`Host ${name} not found or registrar is not authorized`);
  }
}

export class HostService {
  constructor(private readonly repository: HostRepository) {}

  checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    return this.repository.checkAvailability(names.map((name) => this.canonical(name)));
  }

  async create(input: CreateHostInput): Promise<HostRecord> {
    const name = this.canonical(input.name);
    const [availability] = await this.repository.checkAvailability([name]);

    if (!availability?.available) {
      throw new HostAlreadyExistsError(name);
    }

    return this.repository.create({ ...input, name });
  }

  findByName(name: string): Promise<HostRecord | null> {
    return this.repository.findByName(this.canonical(name));
  }

  async update(name: string, registrarId: string, input: UpdateHostInput): Promise<HostRecord> {
    const canonical = this.canonical(name);
    const existing = await this.repository.findByName(canonical);

    if (!existing || existing.registrarId !== registrarId) {
      throw new HostNotFoundOrUnauthorizedError(canonical);
    }

    assertCanUpdate(existing.statuses, input);
    const host = await this.repository.update(canonical, registrarId, input);

    if (!host) {
      throw new HostNotFoundOrUnauthorizedError(this.canonical(name));
    }

    return host;
  }

  async delete(name: string, registrarId: string): Promise<void> {
    const canonical = this.canonical(name);
    const existing = await this.repository.findByName(canonical);

    if (!existing || existing.registrarId !== registrarId) {
      throw new HostNotFoundOrUnauthorizedError(canonical);
    }

    assertCanDelete(existing.statuses);
    const deleted = await this.repository.delete(canonical, registrarId);

    if (!deleted) {
      throw new HostNotFoundOrUnauthorizedError(this.canonical(name));
    }
  }

  list(): Promise<HostRecord[]> {
    return this.repository.list();
  }

  reset(records?: HostRecord[]): Promise<void> {
    return this.repository.reset(records);
  }

  private canonical(name: string): string {
    try {
      return canonicalHostName(name).replace(/\.$/, "");
    } catch (error) {
      if (error instanceof RegistryPolicyError) {
        throw new HostValidationError(error.reason);
      }

      throw error;
    }
  }
}
