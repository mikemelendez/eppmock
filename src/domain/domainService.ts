import type { CreateDomainInput, DomainRecord, DomainRepository, UpdateDomainInput } from "./types.js";
import { canonicalHostName, RegistryPolicy, RegistryPolicyError } from "./registryPolicy.js";

/** ICANN-style registration period cap enforced on create and renew. */
export const MAX_REGISTRATION_YEARS = 10;

export class DomainService {
  private readonly policy: RegistryPolicy;

  constructor(
    private readonly repository: DomainRepository,
    registryTld = "melendez"
  ) {
    this.policy = new RegistryPolicy(registryTld);
  }

  async checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    const normalizedNames = names.map((name) => this.policy.normalizeDomainName(name).canonicalName);
    return this.repository.checkAvailability(normalizedNames);
  }

  async create(input: CreateDomainInput): Promise<DomainRecord> {
    const name = this.policy.normalizeDomainName(input.name).canonicalName;
    const periodYears = normalizePeriodYears(input.periodYears, name);
    const [availability] = await this.repository.checkAvailability([name]);

    if (!availability?.available) {
      throw new DomainAlreadyExistsError(name);
    }

    return this.repository.create({ ...input, name, periodYears, nameservers: normalizeHostNames(input.nameservers) });
  }

  findByName(name: string): Promise<DomainRecord | null> {
    return this.repository.findByName(this.policy.normalizeDomainName(name).canonicalName);
  }

  async update(name: string, registrarId: string, input: UpdateDomainInput): Promise<DomainRecord> {
    const normalizedName = this.policy.normalizeDomainName(name).canonicalName;
    const domain = await this.repository.update(normalizedName, registrarId, normalizeUpdateInput(input));

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    return domain;
  }

  async delete(name: string, registrarId: string): Promise<void> {
    const normalizedName = this.policy.normalizeDomainName(name).canonicalName;
    const deleted = await this.repository.delete(normalizedName, registrarId);

    if (!deleted) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }
  }

  /**
   * RFC 3915 delete: within the add grace period the domain is purged immediately;
   * otherwise it enters the redemption grace period (pendingDelete) and can be restored.
   */
  async deleteWithGrace(
    name: string,
    registrarId: string
  ): Promise<{ hardDeleted: boolean; domain?: DomainRecord }> {
    const normalizedName = this.policy.normalizeDomainName(name).canonicalName;
    const domain = await this.repository.findByName(normalizedName);

    if (!domain || domain.registrarId !== registrarId) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    if (withinAddGracePeriod(domain.createdAt)) {
      await this.repository.delete(normalizedName, registrarId);
      return { hardDeleted: true };
    }

    const updated = await this.repository.update(normalizedName, registrarId, {
      statusesToAdd: ["pendingDelete"],
      rgpStatus: "redemptionPeriod"
    });

    return { hardDeleted: false, domain: updated ?? undefined };
  }

  async restore(name: string, registrarId: string): Promise<DomainRecord> {
    const normalizedName = this.policy.normalizeDomainName(name).canonicalName;
    const domain = await this.repository.findByName(normalizedName);

    if (!domain || domain.registrarId !== registrarId || domain.rgpStatus !== "redemptionPeriod") {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    const updated = await this.repository.update(normalizedName, registrarId, {
      statusesToRemove: ["pendingDelete"],
      rgpStatus: "pendingRestore"
    });

    if (!updated) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    return updated;
  }

  async renew(name: string, registrarId: string, periodYears?: number): Promise<DomainRecord> {
    const normalizedName = this.policy.normalizeDomainName(name).canonicalName;
    const period = normalizePeriodYears(periodYears, normalizedName);
    const domain = await this.repository.renew(normalizedName, registrarId, period);

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    return domain;
  }

  async transfer(
    name: string,
    operation: "request" | "approve" | "reject" | "cancel" | "query",
    registrarId: string
  ): Promise<DomainRecord> {
    const normalizedName = this.policy.normalizeDomainName(name).canonicalName;
    const domain = await this.repository.setTransfer(normalizedName, operation, registrarId);

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    return domain;
  }

  async list(): Promise<DomainRecord[]> {
    const domains = await this.repository.list();
    return domains.filter((domain) => this.policy.isValidDomainName(domain.name));
  }

  reset(records?: DomainRecord[]): Promise<void> {
    const normalizedRecords = records?.map((record) => ({
      ...record,
      name: this.policy.normalizeDomainName(record.name).canonicalName,
      nameservers: normalizeHostNames(record.nameservers) ?? []
    }));
    return this.repository.reset(normalizedRecords);
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

export { RegistryPolicyError };

const ADD_GRACE_PERIOD_DAYS = 5;

function normalizePeriodYears(periodYears: number | undefined, name: string): number {
  const period = periodYears ?? 1;

  if (!Number.isInteger(period) || period < 1 || period > MAX_REGISTRATION_YEARS) {
    throw new RegistryPolicyError(name, `registration period must be between 1 and ${MAX_REGISTRATION_YEARS} years`);
  }

  return period;
}

function withinAddGracePeriod(createdAt: string): boolean {
  const created = new Date(createdAt).getTime();

  if (Number.isNaN(created)) {
    return false;
  }

  const ageMs = Date.now() - created;
  return ageMs <= ADD_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
}

function normalizeUpdateInput(input: UpdateDomainInput): UpdateDomainInput {
  return {
    ...input,
    nameserversToAdd: normalizeHostNames(input.nameserversToAdd),
    nameserversToRemove: normalizeHostNames(input.nameserversToRemove)
  };
}

function normalizeHostNames(nameservers: string[] | undefined): string[] | undefined {
  return nameservers?.map(canonicalHostName);
}
