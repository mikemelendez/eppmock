import test from "node:test";
import assert from "node:assert/strict";
import { defaultAuthUsers } from "../config.js";
import { DomainService } from "../domain/domainService.js";
import { InMemoryDomainRepository } from "../domain/inMemoryDomainRepository.js";
import { DomainCommandHandler } from "./domainCommandHandler.js";
import { PollMessageRepository } from "./pollMessageRepository.js";
import { SystemCommandHandler } from "./systemCommandHandler.js";
import type { CommandContext } from "./types.js";
import { parseEppXml } from "./xml.js";

function context(): CommandContext {
  return {
    session: {
      id: "s",
      authenticated: true,
      clid: "melendez-registrar",
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: "",
    transactionId: "trid"
  };
}

test("RGP: deleting an aged domain enters redemptionPeriod and can be restored", async () => {
  const repository = new InMemoryDomainRepository();
  const service = new DomainService(repository);
  await repository.reset([
    {
      name: "aged.melendez",
      registrarId: "melendez-registrar",
      periodYears: 1,
      statuses: ["ok"],
      nameservers: [],
      contacts: [],
      dsRecords: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z"
    }
  ]);

  const deleted = await service.deleteWithGrace("aged.melendez", "melendez-registrar");
  assert.equal(deleted.hardDeleted, false);
  assert.equal(deleted.domain?.rgpStatus, "redemptionPeriod");
  assert.ok(deleted.domain?.statuses.includes("pendingDelete"));

  const restored = await service.restore("aged.melendez", "melendez-registrar");
  assert.equal(restored.rgpStatus, "pendingRestore");
  assert.ok(!restored.statuses.includes("pendingDelete"));
});

test("RGP: deleting a freshly created domain purges it immediately", async () => {
  const service = new DomainService(new InMemoryDomainRepository());
  await service.create({ name: "fresh.melendez", registrarId: "melendez-registrar" });

  const deleted = await service.deleteWithGrace("fresh.melendez", "melendez-registrar");
  assert.equal(deleted.hardDeleted, true);
  assert.equal(await service.findByName("fresh.melendez"), null);
});

test("RGP: domain:info exposes rgp:infData after redemption", async () => {
  const repository = new InMemoryDomainRepository();
  const service = new DomainService(repository);
  const handler = new DomainCommandHandler(service);
  await repository.reset([
    {
      name: "aged.melendez",
      registrarId: "melendez-registrar",
      periodYears: 1,
      statuses: ["ok"],
      nameservers: [],
      contacts: [],
      dsRecords: [],
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z"
    }
  ]);
  await service.deleteWithGrace("aged.melendez", "melendez-registrar");

  const infoXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info><domain:info xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>aged.melendez</domain:name></domain:info></info>
  </command>
</epp>`;
  const info = await handler.handle(parseEppXml(infoXml), context());
  assert.match(info, /<rgp:infData/);
  assert.match(info, /<rgp:rgpStatus s="redemptionPeriod"/);
});

test("Launch: create with launch extension returns launch:creData with application id", async () => {
  const service = new DomainService(new InMemoryDomainRepository());
  const handler = new DomainCommandHandler(service);

  const createXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>sunrise.melendez</domain:name>
        <domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo>
      </domain:create>
    </create>
    <extension>
      <launch:create xmlns:launch="urn:ietf:params:xml:ns:launch-1.0">
        <launch:phase>sunrise</launch:phase>
      </launch:create>
    </extension>
  </command>
</epp>`;
  const response = await handler.handle(parseEppXml(createXml), context());
  assert.match(response, /<launch:creData/);
  assert.match(response, /<launch:phase>sunrise<\/launch:phase>/);
  assert.match(response, /<launch:applicationID>/);
});

test("Poll: queued message returns 1301 and ack dequeues it", async () => {
  const pollMessages = new PollMessageRepository();
  pollMessages.enqueue({ registrarId: "melendez-registrar", text: "Transfer requested for x.melendez" });
  const handler = new SystemCommandHandler({ greetingServerId: "epp-testing-tool" }, pollMessages);

  const reqXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><poll op="req"/><clTRID>p1</clTRID></command></epp>`;
  const req = await handler.handle(parseEppXml(reqXml), context());
  assert.match(req, /<result code="1301">/);
  assert.match(req, /<msgQ count="1"/);

  const messageId = req.match(/<msgQ count="1" id="([^"]+)"/)?.[1];
  assert.ok(messageId);

  const ackXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><poll op="ack" msgID="${messageId}"/><clTRID>p2</clTRID></command></epp>`;
  const ack = await handler.handle(parseEppXml(ackXml), context());
  assert.match(ack, /<result code="1000">/);
  assert.match(ack, /<msgQ count="0"/);

  const empty = await handler.handle(parseEppXml(reqXml), context());
  assert.match(empty, /<result code="1300">/);
});

test("greeting and default auth users remain available", () => {
  assert.equal(defaultAuthUsers[0].clid, "melendez-admin");
});
