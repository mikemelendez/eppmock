import type { CreateDomainInput, DomainRecord, DomainRepository, UpdateDomainInput } from "./types.js";

export class DomainService {
  constructor(private readonly repository: DomainRepository) {}

  checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    return this.repository.checkAvailability(names);
  }

  async create(input: CreateDomainInput): Promise<DomainRecord> {
    const [availability] = await this.repository.checkAvailability([input.name]);

    if (!availability?.available) {
      throw new DomainAlreadyExistsError(input.name);
    }

    return this.repository.create(input);
  }

  findByName(name: string): Promise<DomainRecord | null> {
    return this.repository.findByName(name);
  }

  async update(name: string, registrarId: string, input: UpdateDomainInput): Promise<DomainRecord> {
    const domain = await this.repository.update(name, registrarId, input);

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(name);
    }

    return domain;
  }

  async delete(name: string, registrarId: string): Promise<void> {
    const deleted = await this.repository.delete(name, registrarId);

    if (!deleted) {
      throw new DomainNotFoundOrUnauthorizedError(name);
    }
  }

  async renew(name: string, registrarId: string, periodYears?: number): Promise<DomainRecord> {
    const domain = await this.repository.renew(name, registrarId, periodYears);

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(name);
    }

    return domain;
  }

  async transfer(
    name: string,
    operation: "request" | "approve" | "reject" | "cancel" | "query",
    registrarId: string
  ): Promise<DomainRecord> {
    const domain = await this.repository.setTransfer(name, operation, registrarId);

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(name);
    }

    return domain;
  }

  list(): Promise<DomainRecord[]> {
    return this.repository.list();
  }

  reset(records?: DomainRecord[]): Promise<void> {
    return this.repository.reset(records);
  }
}

export class DomainAlreadyExistsError extends Error {
  constructor(name: string) {
    super(`Domain ${name} already exists`);
  }
}

export class DomainNotFoundOrUnauthorizedError extends Error {
  constructor(name: string) {
    super(`Domain ${name} not found or registrar is not authorized`);
  }
}
