import { loadConfig } from "./config.js";
import { startControlServer } from "./control/controlServer.js";
import { DomainService } from "./domain/domainService.js";
import { InMemoryDomainRepository } from "./domain/inMemoryDomainRepository.js";
import { SqliteDomainRepository } from "./domain/sqliteDomainRepository.js";
import type { DomainRepository } from "./domain/types.js";
import { AuthCommandHandler } from "./epp/authCommandHandler.js";
import { CommandLogRepository } from "./epp/commandLogRepository.js";
import { CommandRouter } from "./epp/commandRouter.js";
import { DomainCommandHandler } from "./epp/domainCommandHandler.js";
import { startEppServer } from "./epp/eppServer.js";
import { SystemCommandHandler } from "./epp/systemCommandHandler.js";

const config = loadConfig();

const domainRepository: DomainRepository =
  config.storageMode === "memory"
    ? new InMemoryDomainRepository()
    : new SqliteDomainRepository(config.sqlitePath);
const domainService = new DomainService(domainRepository);
const commandLog = new CommandLogRepository();

const authHandler = new AuthCommandHandler(config);
const domainHandler = new DomainCommandHandler(domainService);
const systemHandler = new SystemCommandHandler(config);
const router = new CommandRouter(authHandler, commandLog);

router.register("domain:check", domainHandler);
router.register("domain:create", domainHandler);
router.register("domain:info", domainHandler);
router.register("domain:delete", domainHandler);
router.register("domain:update", domainHandler);
router.register("domain:renew", domainHandler);
router.register("domain:transfer", domainHandler);
router.register("poll", systemHandler);
router.register("hello", systemHandler);

startEppServer(config, router);
await startControlServer(config, domainService, commandLog);
