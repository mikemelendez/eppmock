import { loadConfig } from "./config.js";
import { ContactService } from "./contact/contactService.js";
import { InMemoryContactRepository } from "./contact/inMemoryContactRepository.js";
import { startControlServer } from "./control/controlServer.js";
import { DomainService } from "./domain/domainService.js";
import { InMemoryDomainRepository } from "./domain/inMemoryDomainRepository.js";
import { SqliteDomainRepository } from "./domain/sqliteDomainRepository.js";
import type { DomainRepository } from "./domain/types.js";
import { HostService } from "./host/hostService.js";
import { InMemoryHostRepository } from "./host/inMemoryHostRepository.js";
import { AuthCommandHandler } from "./epp/authCommandHandler.js";
import { CommandLogRepository } from "./epp/commandLogRepository.js";
import { CommandRouter } from "./epp/commandRouter.js";
import { ContactCommandHandler } from "./epp/contactCommandHandler.js";
import { DomainCommandHandler } from "./epp/domainCommandHandler.js";
import { startEppServer } from "./epp/eppServer.js";
import { HostCommandHandler } from "./epp/hostCommandHandler.js";
import { PollMessageRepository } from "./epp/pollMessageRepository.js";
import { SystemCommandHandler } from "./epp/systemCommandHandler.js";
import { startRdapServer } from "./rdap/rdapServer.js";
import { startWhoisServer } from "./whois/whoisServer.js";

const config = loadConfig();

const domainRepository: DomainRepository =
  config.storageMode === "memory"
    ? new InMemoryDomainRepository()
    : new SqliteDomainRepository(config.sqlitePath);
const domainService = new DomainService(domainRepository, config.registryTld);
const contactService = new ContactService(new InMemoryContactRepository());
const hostService = new HostService(new InMemoryHostRepository());
const commandLog = new CommandLogRepository();
const pollMessages = new PollMessageRepository();

const authHandler = new AuthCommandHandler(config);
const domainHandler = new DomainCommandHandler(domainService, pollMessages);
const contactHandler = new ContactCommandHandler(contactService);
const hostHandler = new HostCommandHandler(hostService);
const systemHandler = new SystemCommandHandler(config, pollMessages);
const router = new CommandRouter(authHandler, commandLog);

router.register("domain:check", domainHandler);
router.register("domain:create", domainHandler);
router.register("domain:info", domainHandler);
router.register("domain:delete", domainHandler);
router.register("domain:update", domainHandler);
router.register("domain:renew", domainHandler);
router.register("domain:transfer", domainHandler);
router.register("contact:check", contactHandler);
router.register("contact:create", contactHandler);
router.register("contact:info", contactHandler);
router.register("contact:update", contactHandler);
router.register("contact:delete", contactHandler);
router.register("host:check", hostHandler);
router.register("host:create", hostHandler);
router.register("host:info", hostHandler);
router.register("host:update", hostHandler);
router.register("host:delete", hostHandler);
router.register("poll", systemHandler);
router.register("hello", systemHandler);

startEppServer(config, router);
startWhoisServer(config, domainService);
await startRdapServer(config, { domains: domainService, hosts: hostService, contacts: contactService });
await startControlServer(config, domainService, commandLog);
