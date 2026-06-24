import type { CreateHostInput, HostAddress, HostRecord, HostRepository, UpdateHostInput } from "./types.js";

export class InMemoryHostRepository implements HostRepository {
  private hosts = new Map<string, HostRecord>();

  async checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>> {
    return names.map((name) => ({
      name,
      available: !this.hosts.has(normalizeName(name))
    }));
  }

  async create(input: CreateHostInput): Promise<HostRecord> {
    const name = normalizeName(input.name);

    if (this.hosts.has(name)) {
      throw new Error(`Host ${name} already exists`);
    }

    const record: HostRecord = {
      name,
      registrarId: input.registrarId,
      roid: `${name.toUpperCase()}-EPP`,
      statuses: ["ok"],
      addresses: dedupeAddresses(input.addresses ?? []),
      createdAt: new Date().toISOString()
    };

    this.hosts.set(name, record);
    return record;
  }

  async findByName(name: string): Promise<HostRecord | null> {
    return this.hosts.get(normalizeName(name)) ?? null;
  }

  async update(name: string, registrarId: string, input: UpdateHostInput): Promise<HostRecord | null> {
    const normalizedName = normalizeName(name);
    const host = this.hosts.get(normalizedName);

    if (!host || host.registrarId !== registrarId) {
      return null;
    }

    const updated: HostRecord = {
      ...host,
      addresses: updateAddresses(host.addresses, input.addressesToAdd, input.addressesToRemove),
      statuses: normalizeStatuses(updateList(host.statuses, input.statusesToAdd, input.statusesToRemove)),
      updatedAt: new Date().toISOString()
    };

    this.hosts.set(normalizedName, updated);
    return updated;
  }

  async delete(name: string, registrarId: string): Promise<boolean> {
    const normalizedName = normalizeName(name);
    const host = this.hosts.get(normalizedName);

    if (!host || host.registrarId !== registrarId) {
      return false;
    }

    return this.hosts.delete(normalizedName);
  }

  async list(): Promise<HostRecord[]> {
    return [...this.hosts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async reset(records: HostRecord[] = []): Promise<void> {
    this.hosts.clear();

    for (const record of records) {
      this.hosts.set(normalizeName(record.name), {
        ...record,
        name: normalizeName(record.name),
        addresses: dedupeAddresses(record.addresses ?? [])
      });
    }
  }
}

function normalizeName(name: string): string {
  return name.trim().replace(/\.$/, "").toLowerCase();
}

function addressKey(address: HostAddress): string {
  return `${address.version}:${address.ip.toLowerCase()}`;
}

function dedupeAddresses(addresses: HostAddress[]): HostAddress[] {
  const map = new Map(addresses.map((address) => [addressKey(address), address]));
  return [...map.values()];
}

function updateAddresses(
  current: HostAddress[],
  toAdd: HostAddress[] = [],
  toRemove: HostAddress[] = []
): HostAddress[] {
  const removeSet = new Set(toRemove.map(addressKey));
  const map = new Map(
    current.filter((address) => !removeSet.has(addressKey(address))).map((address) => [addressKey(address), address])
  );

  for (const address of toAdd) {
    map.set(addressKey(address), address);
  }

  return [...map.values()];
}

function updateList(current: string[], toAdd: string[] = [], toRemove: string[] = []): string[] {
  const removeSet = new Set(toRemove.map((value) => value.trim()));
  return [...new Set([...current.filter((value) => !removeSet.has(value)), ...toAdd])];
}

function normalizeStatuses(statuses: string[]): string[] {
  const normalized = [...new Set(statuses.map((value) => value.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : ["ok"];
}
