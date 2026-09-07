import { loadConfig } from "./config.js";
import { ContactService } from "./contact/contactService.js";
import { InMemoryContactRepository } from "./contact/inMemoryContactRepository.js";
import { SqliteContactRepository } from "./contact/sqliteContactRepository.js";
import type { ContactRepository } from "./contact/types.js";
import { startControlServer } from "./control/controlServer.js";
import { DomainService } from "./domain/domainService.js";
import { InMemoryDomainRepository } from "./domain/inMemoryDomainRepository.js";
import { SqliteDomainRepository } from "./domain/sqliteDomainRepository.js";
import type { DomainRepository } from "./domain/types.js";
import { HostService } from "./host/hostService.js";
import { InMemoryHostRepository } from "./host/inMemoryHostRepository.js";
import { SqliteHostRepository } from "./host/sqliteHostRepository.js";
import type { HostRepository } from "./host/types.js";
import { AuthCommandHandler } from "./epp/authCommandHandler.js";
import { CommandLogRepository } from "./epp/commandLogRepository.js";
import { CommandRouter } from "./epp/commandRouter.js";
import { ContactCommandHandler } from "./epp/contactCommandHandler.js";
import { DomainCommandHandler } from "./epp/domainCommandHandler.js";
import { startEppServer } from "./epp/eppServer.js";
import { HostCommandHandler } from "./epp/hostCommandHandler.js";
import { PollMessageRepository } from "./epp/pollMessageRepository.js";
import { setRepositoryId } from "./epp/roid.js";
import { SystemCommandHandler } from "./epp/systemCommandHandler.js";
import { startRdapServer } from "./rdap/rdapServer.js";
import { RegistryLinks } from "./registry/registryLinks.js";
import { startWhoisServer } from "./whois/whoisServer.js";

const config = loadConfig();
setRepositoryId(config.repositoryId);

const useSqlite = config.storageMode === "sqlite";

const domainRepository: DomainRepository = useSqlite
  ? new SqliteDomainRepository(config.sqlitePath)
  : new InMemoryDomainRepository();
const contactRepository: ContactRepository = useSqlite
  ? new SqliteContactRepository(config.sqlitePath)
  : new InMemoryContactRepository();
const hostRepository: HostRepository = useSqlite
  ? new SqliteHostRepository(config.sqlitePath)
  : new InMemoryHostRepository();

const links = new RegistryLinks();
const domainService = new DomainService(domainRepository, config.registryTld, links);
const contactService = new ContactService(contactRepository, links);
const hostService = new HostService(hostRepository, config.registryTld, links);
links.domains = domainService;
links.contacts = contactService;
links.hosts = hostService;
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

if (config.eppDashboardPort && config.eppDashboardPort !== config.eppPort) {
  startEppServer(config, router, {
    host: config.eppDashboardHost ?? "127.0.0.1",
    port: config.eppDashboardPort,
    label: "EPP dashboard (localhost)",
    tls: false,
    exitOnError: false
  });
}
startWhoisServer(config, domainService);
await startRdapServer(config, { domains: domainService, hosts: hostService, contacts: contactService });
await startControlServer(config, domainService, commandLog);
