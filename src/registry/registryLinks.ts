import type { ContactService } from "../contact/contactService.js";
import type { DomainService } from "../domain/domainService.js";
import type { HostService } from "../host/hostService.js";

/**
 * Late-bound handle so domain, contact, and host services can enforce
 * referential integrity without a circular constructor graph.
 */
export class RegistryLinks {
  domains?: DomainService;
  contacts?: ContactService;
  hosts?: HostService;
}

export class ObjectDoesNotExistError extends Error {
  constructor(readonly objectType: "contact" | "host" | "domain", readonly objectId: string) {
    super(`${objectType} ${objectId} does not exist`);
  }
}

export class ObjectAssociationProhibitsOperationError extends Error {
  constructor(readonly objectId: string) {
    super(`Object association prohibits operation on ${objectId}`);
  }
}

export class HostAttributeNotSupportedError extends Error {
  constructor() {
    super("Host attributes are not supported; this registry uses host objects");
  }
}
