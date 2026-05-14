export interface DomainRecord {
  name: string;
  registrarId: string;
  periodYears: number;
  statuses: string[];
  nameservers: string[];
  registrantContact?: string;
  contacts: DomainContact[];
  authInfo?: string;
  createdAt: string;
  updatedAt?: string;
  expiresAt: string;
  transfer?: DomainTransfer;
}

export interface CreateDomainInput {
  name: string;
  registrarId: string;
  periodYears?: number;
  nameservers?: string[];
  registrantContact?: string;
  contacts?: DomainContact[];
  authInfo?: string;
}

export interface UpdateDomainInput {
  nameserversToAdd?: string[];
  nameserversToRemove?: string[];
  contactsToAdd?: DomainContact[];
  contactsToRemove?: DomainContact[];
  statusesToAdd?: string[];
  statusesToRemove?: string[];
  registrantContact?: string;
  authInfo?: string;
}

export interface DomainContact {
  type: "admin" | "tech" | "billing";
  id: string;
}

export interface DomainTransfer {
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedBy: string;
  requestedAt: string;
  updatedAt: string;
}

export type TransferStatus = DomainTransfer["status"];

export interface DomainRepository {
  checkAvailability(names: string[]): Promise<Array<{ name: string; available: boolean }>>;
  create(input: CreateDomainInput): Promise<DomainRecord>;
  findByName(name: string): Promise<DomainRecord | null>;
  update(name: string, registrarId: string, input: UpdateDomainInput): Promise<DomainRecord | null>;
  delete(name: string, registrarId: string): Promise<boolean>;
  renew(name: string, registrarId: string, periodYears?: number): Promise<DomainRecord | null>;
  setTransfer(
    name: string,
    operation: "request" | "approve" | "reject" | "cancel" | "query",
    registrarId: string
  ): Promise<DomainRecord | null>;
  list(): Promise<DomainRecord[]>;
  reset(records?: DomainRecord[]): Promise<void>;
}
