export interface HostAddress {
  ip: string;
  version: "v4" | "v6";
}

export interface HostRecord {
  name: string;
  registrarId: string;
  creatorId: string;
  roid: string;
  statuses: string[];
  addresses: HostAddress[];
  createdAt: string;
  updatedAt?: string;
}

export interface CreateHostInput {
  name: string;
  registrarId: string;
  addresses?: HostAddress[];
}

export interface UpdateHostInput {
  addressesToAdd?: HostAddress[];
  addressesToRemove?: HostAddress[];
  statusesToAdd?: string[];
  statusesToRemove?: string[];
  newName?: string;
}

export interface HostRepository {
  checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>>;
  create(input: CreateHostInput): Promise<HostRecord>;
  findByName(name: string): Promise<HostRecord | null>;
  update(name: string, registrarId: string, input: UpdateHostInput): Promise<HostRecord | null>;
  delete(name: string, registrarId: string): Promise<boolean>;
  /** Point a host at a registrar. Used to restore seeded glue hosts. */
  setSponsor(name: string, registrarId: string): Promise<HostRecord | null>;
  list(): Promise<HostRecord[]>;
  reset(records?: HostRecord[]): Promise<void>;
}
