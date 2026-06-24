export interface ContactPostalInfo {
  type: "int" | "loc";
  name: string;
  org?: string;
  street: string[];
  city: string;
  sp?: string;
  pc?: string;
  cc: string;
}

export interface ContactRecord {
  id: string;
  registrarId: string;
  roid: string;
  statuses: string[];
  postalInfo: ContactPostalInfo[];
  voice?: string;
  fax?: string;
  email: string;
  authInfo?: string;
  disclose?: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateContactInput {
  id: string;
  registrarId: string;
  postalInfo: ContactPostalInfo[];
  voice?: string;
  fax?: string;
  email: string;
  authInfo?: string;
}

export interface UpdateContactInput {
  statusesToAdd?: string[];
  statusesToRemove?: string[];
  postalInfo?: ContactPostalInfo[];
  voice?: string;
  fax?: string;
  email?: string;
  authInfo?: string;
}

export interface ContactRepository {
  checkAvailability(ids: string[]): Promise<Array<{ id: string; available: boolean }>>;
  create(input: CreateContactInput): Promise<ContactRecord>;
  findById(id: string): Promise<ContactRecord | null>;
  update(id: string, registrarId: string, input: UpdateContactInput): Promise<ContactRecord | null>;
  delete(id: string, registrarId: string): Promise<boolean>;
  list(): Promise<ContactRecord[]>;
  reset(records?: ContactRecord[]): Promise<void>;
}
