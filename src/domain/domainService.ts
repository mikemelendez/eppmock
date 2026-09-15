import {
  assertCanDelete,
  assertCanRenew,
  assertCanTransferRequest,
  assertCanUpdate,
  ObjectStatusProhibitsOperationError
} from "../epp/objectStatusPolicy.js";
import { DnssecPolicyError } from "../epp/dnssecPolicy.js";
import { allocateRoid } from "../epp/roid.js";
import {
  HostAttributeNotSupportedError,
  ObjectDoesNotExistError,
  type RegistryLinks
} from "../registry/registryLinks.js";
import type { CreateDomainInput, DomainRecord, DomainRepository, UpdateDomainInput } from "./types.js";
import { canonicalHostName, RegistryPolicy, RegistryPolicyError } from "./registryPolicy.js";

export { ObjectStatusProhibitsOperationError, DnssecPolicyError, HostAttributeNotSupportedError, ObjectDoesNotExistError };

/** ICANN-style registration period cap enforced on create, renew, and transfer. */
export const MAX_REGISTRATION_YEARS = 10;

export class DomainService {
  private readonly policy: RegistryPolicy;

  constructor(
    private readonly repository: DomainRepository,
    registryTld = "melendez",
    private readonly links?: RegistryLinks
  ) {
    this.policy = new RegistryPolicy(registryTld);
  }

  /**
   * RST epp-04: a check command may mix valid, reserved, and syntactically invalid
   * names. Each name gets its own `avail` flag — reserved/invalid names are
   * unavailable (`0`) instead of failing the whole command with 2005.
   */
  async checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    return Promise.all(
      names.map(async (name) => {
        try {
          const canonicalName = this.policy.normalizeDomainName(name).canonicalName;
          const [result] = await this.repository.checkAvailability([canonicalName]);
          return { name: canonicalName, available: result?.available ?? true };
        } catch (error) {
          if (error instanceof RegistryPolicyError) {
            return { name, available: false };
          }

          throw error;
        }
      })
    );
  }

  async create(input: CreateDomainInput): Promise<DomainRecord> {
    const name = this.policy.normalizeDomainName(input.name).canonicalName;
    const periodYears = normalizePeriodYears(input.periodYears, name);

    if (this.links?.contacts && !input.registrantContact) {
      throw new RequiredParameterError("registrant");
    }

    await this.assertReferencedObjects(input.registrantContact, input.contacts, input.nameservers);
    const [availability] = await this.repository.checkAvailability([name]);

    if (!availability?.available) {
      throw new DomainAlreadyExistsError(name);
    }

    return this.repository.create({
      ...input,
      name,
      periodYears,
      nameservers: normalizeHostNames(input.nameservers)
    });
  }

  findByName(name: string): Promise<DomainRecord | null> {
    return this.repository.findByName(this.lookupName(name));
  }

  /**
   * Insert a registry-held name (including Specification 5 reserved labels such as nic)
   * if it is not already present. Registrars still cannot <create> reserved names.
   */
  async ensureRegistered(input: CreateDomainInput): Promise<DomainRecord> {
    const name = this.lookupName(input.name);
    const existing = await this.repository.findByName(name);

    if (existing) {
      return existing;
    }

    if (this.links?.contacts && !input.registrantContact) {
      throw new RequiredParameterError("registrant");
    }

    await this.assertReferencedObjects(input.registrantContact, input.contacts, input.nameservers);
    return this.repository.create({
      ...input,
      name,
      periodYears: normalizePeriodYears(input.periodYears, name),
      nameservers: normalizeHostNames(input.nameservers) ?? []
    });
  }

  async update(name: string, registrarId: string, input: UpdateDomainInput): Promise<DomainRecord> {
    const normalizedName = this.lookupName(name);
    const normalizedInput = normalizeUpdateInput(input);
    const existing = await this.repository.findByName(normalizedName);

    if (!existing || existing.registrarId !== registrarId) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    await this.assertReferencedObjects(
      normalizedInput.registrantContact,
      normalizedInput.contactsToAdd,
      normalizedInput.nameserversToAdd
    );
    assertCanUpdate(existing.statuses, normalizedInput);
    const domain = await this.repository.update(normalizedName, registrarId, normalizedInput);

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    return domain;
  }

  async delete(name: string, registrarId: string): Promise<void> {
    const normalizedName = this.lookupName(name);
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
    const normalizedName = this.lookupName(name);
    const domain = await this.repository.findByName(normalizedName);

    if (!domain || domain.registrarId !== registrarId) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    assertCanDelete(domain.statuses);

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
    const normalizedName = this.lookupName(name);
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

  async renew(name: string, registrarId: string, periodYears?: number, currentExpiry?: string): Promise<DomainRecord> {
    const normalizedName = this.lookupName(name);
    const period = normalizePeriodYears(periodYears, normalizedName);
    const existing = await this.repository.findByName(normalizedName);

    if (!existing || existing.registrarId !== registrarId) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    if (currentExpiry && !sameDate(existing.expiresAt, currentExpiry)) {
      throw new RegistryPolicyError(normalizedName, "curExpDate does not match the current expiry date");
    }

    assertCanRenew(existing.statuses);
    assertExpiryWithinTenYears(existing.expiresAt, period, normalizedName);
    const domain = await this.repository.renew(normalizedName, registrarId, period);

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    return domain;
  }

  async transfer(
    name: string,
    operation: "request" | "approve" | "reject" | "cancel" | "query",
    registrarId: string,
    periodYears?: number
  ): Promise<DomainRecord> {
    const normalizedName = this.lookupName(name);
    const existing = await this.repository.findByName(normalizedName);

    if (!existing) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    if (operation === "request") {
      assertCanTransferRequest(existing.statuses);
      const period = normalizePeriodYears(periodYears ?? 1, normalizedName);
      assertExpiryWithinTenYears(existing.expiresAt, period, normalizedName);
      const domain = await this.repository.setTransfer(normalizedName, operation, registrarId, period);

      if (!domain) {
        throw new DomainNotFoundOrUnauthorizedError(normalizedName);
      }

      return domain;
    }

    if ((operation === "approve" || operation === "reject") && existing.registrarId !== registrarId) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    if (operation === "cancel" && existing.transfer?.requestedBy !== registrarId) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    const domain = await this.repository.setTransfer(normalizedName, operation, registrarId);

    if (!domain) {
      throw new DomainNotFoundOrUnauthorizedError(normalizedName);
    }

    return domain;
  }

  async replaceHostName(oldName: string, newName: string): Promise<void> {
    await this.repository.replaceHostName(oldName, newName);
  }

  async list(): Promise<DomainRecord[]> {
    const domains = await this.repository.list();
    return domains.filter((domain) => {
      try {
        this.policy.normalizeDomainName(domain.name, { allowReserved: true });
        return true;
      } catch {
        return false;
      }
    });
  }

  reset(records?: DomainRecord[]): Promise<void> {
    const normalizedRecords = records?.map((record) => ({
      ...record,
      name: this.policy.normalizeDomainName(record.name, { allowReserved: true }).canonicalName,
      nameservers: normalizeHostNames(record.nameservers) ?? [],
      creatorId: record.creatorId ?? record.registrarId,
      roid: record.roid || allocateRoid("D")
    }));
    return this.repository.reset(normalizedRecords);
  }

  private lookupName(name: string): string {
    return this.policy.normalizeDomainName(name, { allowReserved: true }).canonicalName;
  }

  private async assertReferencedObjects(
    registrantContact?: string,
    contacts?: Array<{ id: string }>,
    nameservers?: string[]
  ): Promise<void> {
    if (!this.links) {
      return;
    }

    if (registrantContact) {
      const contact = await this.links.contacts?.findById(registrantContact);

      if (!contact) {
        throw new ObjectDoesNotExistError("contact", registrantContact);
      }
    }

    for (const contact of contacts ?? []) {
      const found = await this.links.contacts?.findById(contact.id);

      if (!found) {
        throw new ObjectDoesNotExistError("contact", contact.id);
      }
    }

    for (const hostName of nameservers ?? []) {
      const host = await this.links.hosts?.findByName(hostName);

      if (!host) {
        throw new ObjectDoesNotExistError("host", hostName);
      }
    }
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

export class RequiredParameterError extends Error {
  constructor(readonly parameter: string) {
    super(`Required parameter missing: ${parameter}`);
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

function assertExpiryWithinTenYears(currentExpiry: string, additionalYears: number, name: string): void {
  const next = new Date(currentExpiry);
  next.setFullYear(next.getFullYear() + additionalYears);
  const max = new Date();
  max.setFullYear(max.getFullYear() + MAX_REGISTRATION_YEARS);

  if (next.getTime() > max.getTime() + 60_000) {
    throw new RegistryPolicyError(name, "resulting expiry would be more than 10 years in the future");
  }
}

function sameDate(left: string, right: string): boolean {
  return left.slice(0, 10) === right.slice(0, 10);
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
