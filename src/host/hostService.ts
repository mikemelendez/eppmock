import { canonicalHostName, RegistryPolicyError } from "../domain/registryPolicy.js";
import {
  assertCanDelete,
  assertCanUpdate,
  assertStatusDelta,
  CLIENT_SETTABLE_HOST_STATUSES,
  ObjectStatusProhibitsOperationError
} from "../epp/objectStatusPolicy.js";
import {
  ObjectAssociationProhibitsOperationError,
  type RegistryLinks
} from "../registry/registryLinks.js";
import { isUsableGlueAddress } from "./glueAddressPolicy.js";
import type { CreateHostInput, HostAddress, HostRecord, HostRepository, UpdateHostInput } from "./types.js";

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
  constructor(
    private readonly repository: HostRepository,
    private readonly registryTld = "melendez",
    private readonly links?: RegistryLinks
  ) {}

  /**
   * RST epp-05: invalid host names return `avail=0` in the same check response
   * as valid names, rather than a 2005 for the whole command.
   */
  async checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    return Promise.all(
      names.map(async (name) => {
        try {
          const canonical = this.canonical(name);
          const [result] = await this.repository.checkAvailability([canonical]);
          return { name: canonical, available: result?.available ?? true };
        } catch (error) {
          if (error instanceof HostValidationError) {
            return { name, available: false };
          }

          throw error;
        }
      })
    );
  }

  async create(input: CreateHostInput): Promise<HostRecord> {
    const name = this.canonical(input.name);
    const addresses = input.addresses ?? [];
    this.assertGlueAddresses(addresses);
    await this.assertCreatePolicy(name, input.registrarId, addresses);

    const [availability] = await this.repository.checkAvailability([name]);

    if (!availability?.available) {
      throw new HostAlreadyExistsError(name);
    }

    return this.repository.create({ ...input, name, addresses });
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

    this.assertGlueAddresses([...(input.addressesToAdd ?? []), ...(input.addressesToRemove ?? [])]);
    assertCanUpdate(existing.statuses, input);
    this.assertClientHostStatuses(input.statusesToAdd);
    this.assertClientHostStatuses(input.statusesToRemove);
    assertStatusDelta(existing.statuses, input.statusesToAdd, input.statusesToRemove);
    this.assertAddressDelta(existing.addresses, input.addressesToAdd, input.addressesToRemove);

    if (input.newName) {
      return this.rename(existing, registrarId, input.newName);
    }

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

    if (await this.isLinked(existing.name)) {
      throw new ObjectAssociationProhibitsOperationError(existing.name);
    }

    const deleted = await this.repository.delete(canonical, registrarId);

    if (!deleted) {
      throw new HostNotFoundOrUnauthorizedError(this.canonical(name));
    }
  }

  list(): Promise<HostRecord[]> {
    return this.repository.list();
  }

  /** Restore a seeded glue host to the registry registrar. */
  async reclaimSponsor(name: string, registrarId: string): Promise<void> {
    await this.repository.setSponsor(this.canonical(name), registrarId);
  }

  reset(records?: HostRecord[]): Promise<void> {
    return this.repository.reset(records);
  }

  private async rename(existing: HostRecord, registrarId: string, newNameInput: string): Promise<HostRecord> {
    const newName = this.canonical(newNameInput);

    if (newName !== existing.name) {
      const [availability] = await this.repository.checkAvailability([newName]);

      if (!availability?.available) {
        throw new HostAlreadyExistsError(newName);
      }
    }

    await this.assertRenamePolicy(existing, registrarId, newName);

    const outOfBailiwick = !this.superordinateDomain(newName);
    const renamed = await this.repository.update(existing.name, registrarId, {
      newName,
      addressesToRemove: outOfBailiwick ? existing.addresses : undefined
    });

    if (!renamed) {
      throw new HostNotFoundOrUnauthorizedError(existing.name);
    }

    await this.links?.domains?.replaceHostName(existing.name, newName);
    return renamed;
  }

  private async assertCreatePolicy(name: string, registrarId: string, addresses: HostAddress[]): Promise<void> {
    if (!this.links?.domains) {
      return;
    }

    const parent = this.superordinateDomain(name);

    if (!parent) {
      return;
    }

    const domain = await this.links.domains.findByName(parent);

    if (!domain) {
      throw new HostValidationError(`superordinate domain ${parent} does not exist`);
    }

    if (domain.registrarId !== registrarId) {
      throw new HostNotFoundOrUnauthorizedError(name);
    }

    if (addresses.length === 0) {
      throw new HostValidationError("in-bailiwick hosts require at least one IP address");
    }
  }

  private async assertRenamePolicy(existing: HostRecord, registrarId: string, newName: string): Promise<void> {
    const newParent = this.superordinateDomain(newName);

    if (newParent) {
      const domain = await this.links?.domains?.findByName(newParent);

      if (!domain) {
        throw new HostValidationError(`superordinate domain ${newParent} does not exist`);
      }

      if (domain.registrarId !== registrarId) {
        throw new HostNotFoundOrUnauthorizedError(newName);
      }
    }

    if (!this.superordinateDomain(existing.name) && (await this.isLinkedToOtherRegistrar(existing.name, registrarId))) {
      throw new ObjectAssociationProhibitsOperationError(existing.name);
    }
  }

  private superordinateDomain(hostName: string): string | undefined {
    const tld = this.registryTld.replace(/^\.+|\.+$/g, "").toLowerCase();
    const labels = hostName.toLowerCase().replace(/\.$/, "").split(".");

    if (labels.length < 3 || labels.at(-1) !== tld) {
      return undefined;
    }

    return `${labels.at(-2)}.${tld}`;
  }

  private async isLinked(name: string): Promise<boolean> {
    const domains = await this.links?.domains?.list();
    const needle = name.toLowerCase();
    return Boolean(domains?.some((domain) => domain.nameservers.some((ns) => ns.toLowerCase() === needle)));
  }

  private async isLinkedToOtherRegistrar(name: string, registrarId: string): Promise<boolean> {
    const domains = await this.links?.domains?.list();
    const needle = name.toLowerCase();
    return Boolean(
      domains?.some(
        (domain) =>
          domain.registrarId !== registrarId && domain.nameservers.some((ns) => ns.toLowerCase() === needle)
      )
    );
  }

  private assertClientHostStatuses(statuses: string[] | undefined): void {
    for (const status of statuses ?? []) {
      if (!CLIENT_SETTABLE_HOST_STATUSES.has(status)) {
        throw new HostValidationError(`Host status ${status} is not client-settable`);
      }
    }
  }

  private assertAddressDelta(
    current: HostAddress[],
    toAdd: HostAddress[] | undefined,
    toRemove: HostAddress[] | undefined
  ): void {
    const present = new Set(current.map(addressKey));

    for (const address of toAdd ?? []) {
      if (present.has(addressKey(address))) {
        throw new HostValidationError(`glue address ${address.ip} is already associated with the host`);
      }
    }

    for (const address of toRemove ?? []) {
      if (!present.has(addressKey(address))) {
        throw new HostValidationError(`glue address ${address.ip} is not associated with the host`);
      }
    }
  }

  private assertGlueAddresses(addresses: HostAddress[]): void {
    for (const address of addresses) {
      if (!isUsableGlueAddress(address.ip, address.version)) {
        throw new HostValidationError(`invalid glue address ${address.ip}`);
      }
    }
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

function addressKey(address: HostAddress): string {
  return `${address.version}:${address.ip.toLowerCase()}`;
}
