import test from "node:test";
import assert from "node:assert/strict";
import { DomainService } from "../domain/domainService.js";
import { InMemoryDomainRepository } from "../domain/inMemoryDomainRepository.js";
import { parseEppXml } from "./xml.js";
import { DomainCommandHandler } from "./domainCommandHandler.js";
import type { CommandContext } from "./types.js";

test("persists secDNS DS records from create and update commands", async () => {
  const repository = new InMemoryDomainRepository();
  const service = new DomainService(repository);
  const handler = new DomainCommandHandler(service);
  const context: CommandContext = {
    session: {
      id: "test-session",
      authenticated: true,
      clid: "melendez-admin",
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: ""
  };

  await handler.handle(parseEppXml(createXml("12345", "AAAAAAAAAAAAAAAA")), context);
  let domain = await service.findByName("signed.melendez");
  assert.equal(domain?.dsRecords.length, 1);
  assert.deepEqual(domain?.dsRecords[0], {
    keyTag: 12345,
    algorithm: 13,
    digestType: 2,
    digest: "AAAAAAAAAAAAAAAA"
  });

  await handler.handle(parseEppXml(updateXml()), context);
  domain = await service.findByName("signed.melendez");
  assert.equal(domain?.dsRecords.length, 1);
  assert.deepEqual(domain?.dsRecords[0], {
    keyTag: 54321,
    algorithm: 13,
    digestType: 2,
    digest: "BBBBBBBBBBBBBBBB"
  });

  const response = await handler.handle(parseEppXml(infoXml()), context);
  assert.match(response, /<secDNS:infData/);
  assert.match(response, /<secDNS:keyTag>54321<\/secDNS:keyTag>/);
  assert.match(response, /<secDNS:digest>BBBBBBBBBBBBBBBB<\/secDNS:digest>/);
});

test("canonicalizes IDNs and rejects domains outside .melendez policy", async () => {
  const repository = new InMemoryDomainRepository();
  const service = new DomainService(repository);
  const handler = new DomainCommandHandler(service);
  const context: CommandContext = {
    session: {
      id: "test-session",
      authenticated: true,
      clid: "melendez-admin",
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: ""
  };

  const idnResponse = await handler.handle(parseEppXml(createDomainXml("café.melendez")), context);
  assert.match(idnResponse, /<domain:name>xn--caf-dma\.melendez<\/domain:name>/);
  assert.ok(await service.findByName("xn--caf-dma.melendez"));
  assert.ok(await service.findByName("café.melendez"));

  const invalidResponse = await handler.handle(parseEppXml(createDomainXml("example.com")), context);
  assert.match(invalidResponse, /<result code="2005">/);
});

test("sponsoring registrar can request transfer even after changing authInfo", async () => {
  const repository = new InMemoryDomainRepository();
  const service = new DomainService(repository);
  const handler = new DomainCommandHandler(service);
  const context: CommandContext = {
    session: {
      id: "test-session",
      authenticated: true,
      clid: "melendez-admin",
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: ""
  };

  await handler.handle(parseEppXml(createDomainWithAuthXml("lifecycle.melendez", "ci-auth")), context);
  await handler.handle(parseEppXml(changeAuthInfoXml("lifecycle.melendez", "ci-auth-updated")), context);
  assert.equal((await service.findByName("lifecycle.melendez"))?.authInfo, "ci-auth-updated");

  // The sponsoring registrar presents the stale authInfo but is implicitly authorized.
  const transferResponse = await handler.handle(
    parseEppXml(transferXml("lifecycle.melendez", "request", "ci-auth")),
    context
  );
  assert.match(transferResponse, /<result code="1000">/);
  assert.doesNotMatch(transferResponse, /code="2202"/);
});

test("non-sponsoring registrar must present matching authInfo to request transfer", async () => {
  const repository = new InMemoryDomainRepository();
  const service = new DomainService(repository);
  const handler = new DomainCommandHandler(service);
  const owner: CommandContext = {
    session: {
      id: "owner-session",
      authenticated: true,
      clid: "melendez-admin",
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: ""
  };
  const gaining: CommandContext = {
    session: {
      id: "gaining-session",
      authenticated: true,
      clid: "melendez-registrar",
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: ""
  };

  await handler.handle(parseEppXml(createDomainWithAuthXml("guarded.melendez", "right-pw")), owner);

  const wrong = await handler.handle(parseEppXml(transferXml("guarded.melendez", "request", "wrong-pw")), gaining);
  assert.match(wrong, /<result code="2202">/);

  const correct = await handler.handle(parseEppXml(transferXml("guarded.melendez", "request", "right-pw")), gaining);
  assert.match(correct, /<result code="1000">/);
});

function createDomainWithAuthXml(name: string, pw: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${name}</domain:name>
        <domain:period unit="y">1</domain:period>
        <domain:authInfo><domain:pw>${pw}</domain:pw></domain:authInfo>
      </domain:create>
    </create>
  </command>
</epp>`;
}

function changeAuthInfoXml(name: string, pw: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${name}</domain:name>
        <domain:chg><domain:authInfo><domain:pw>${pw}</domain:pw></domain:authInfo></domain:chg>
      </domain:update>
    </update>
  </command>
</epp>`;
}

function transferXml(name: string, operation: string, pw: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <transfer op="${operation}">
      <domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${name}</domain:name>
        <domain:authInfo><domain:pw>${pw}</domain:pw></domain:authInfo>
      </domain:transfer>
    </transfer>
  </command>
</epp>`;
}

function createXml(keyTag: string, digest: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>signed.melendez</domain:name>
        <domain:period unit="y">1</domain:period>
        <domain:authInfo><domain:pw>secret</domain:pw></domain:authInfo>
      </domain:create>
    </create>
    <extension>
      <secDNS:create xmlns:secDNS="urn:ietf:params:xml:ns:secDNS-1.1">
        <secDNS:dsData>
          <secDNS:keyTag>${keyTag}</secDNS:keyTag>
          <secDNS:alg>13</secDNS:alg>
          <secDNS:digestType>2</secDNS:digestType>
          <secDNS:digest>${digest}</secDNS:digest>
        </secDNS:dsData>
      </secDNS:create>
    </extension>
  </command>
</epp>`;
}

function createDomainXml(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>${name}</domain:name>
        <domain:period unit="y">1</domain:period>
        <domain:authInfo><domain:pw>secret</domain:pw></domain:authInfo>
      </domain:create>
    </create>
  </command>
</epp>`;
}

function updateXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>signed.melendez</domain:name>
      </domain:update>
    </update>
    <extension>
      <secDNS:update xmlns:secDNS="urn:ietf:params:xml:ns:secDNS-1.1">
        <secDNS:add>
          <secDNS:dsData>
            <secDNS:keyTag>54321</secDNS:keyTag>
            <secDNS:alg>13</secDNS:alg>
            <secDNS:digestType>2</secDNS:digestType>
            <secDNS:digest>BBBBBBBBBBBBBBBB</secDNS:digest>
          </secDNS:dsData>
        </secDNS:add>
        <secDNS:rem>
          <secDNS:dsData>
            <secDNS:keyTag>12345</secDNS:keyTag>
            <secDNS:alg>13</secDNS:alg>
            <secDNS:digestType>2</secDNS:digestType>
            <secDNS:digest>AAAAAAAAAAAAAAAA</secDNS:digest>
          </secDNS:dsData>
        </secDNS:rem>
      </secDNS:update>
    </extension>
  </command>
</epp>`;
}

function infoXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <domain:info xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>signed.melendez</domain:name>
      </domain:info>
    </info>
  </command>
</epp>`;
}
