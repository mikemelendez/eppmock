import test from "node:test";
import assert from "node:assert/strict";
import { ContactService } from "../contact/contactService.js";
import { InMemoryContactRepository } from "../contact/inMemoryContactRepository.js";
import { DomainService } from "../domain/domainService.js";
import { InMemoryDomainRepository } from "../domain/inMemoryDomainRepository.js";
import { HostService } from "../host/hostService.js";
import { InMemoryHostRepository } from "../host/inMemoryHostRepository.js";
import { RegistryLinks } from "../registry/registryLinks.js";
import { isValidRoid } from "./roid.js";
import { ContactCommandHandler } from "./contactCommandHandler.js";
import { DomainCommandHandler } from "./domainCommandHandler.js";
import { HostCommandHandler } from "./hostCommandHandler.js";
import { AuthCommandHandler } from "./authCommandHandler.js";
import { defaultAuthUsers } from "../config.js";
import type { CommandContext } from "./types.js";
import { parseEppXml } from "./xml.js";
import { greeting } from "./responses.js";

function ctx(clid = "melendez-registrar"): CommandContext {
  return {
    session: {
      id: "rst",
      authenticated: true,
      clid,
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: "",
    transactionId: "rst-1"
  };
}

function registry() {
  const links = new RegistryLinks();
  const domains = new DomainService(new InMemoryDomainRepository(), "melendez", links);
  const contacts = new ContactService(new InMemoryContactRepository(), links);
  const hosts = new HostService(new InMemoryHostRepository(), "melendez", links);
  links.domains = domains;
  links.contacts = contacts;
  links.hosts = hosts;
  return {
    domains,
    contacts,
    hosts,
    domainHandler: new DomainCommandHandler(domains),
    contactHandler: new ContactCommandHandler(contacts),
    hostHandler: new HostCommandHandler(hosts)
  };
}

const SHA256 = "A".repeat(64);

function contactCreateXml(id: string, extras: { cc?: string; email?: string; voice?: string; type?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <contact:create xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>${id}</contact:id>
        <contact:postalInfo type="${extras.type ?? "int"}">
          <contact:name>RST User</contact:name>
          <contact:addr>
            <contact:city>Los Angeles</contact:city>
            <contact:cc>${extras.cc ?? "US"}</contact:cc>
          </contact:addr>
        </contact:postalInfo>
        ${extras.voice ? `<contact:voice>${extras.voice}</contact:voice>` : ""}
        <contact:email>${extras.email ?? "rst@example.net"}</contact:email>
        <contact:authInfo><contact:pw>2fooBAR</contact:pw></contact:authInfo>
      </contact:create>
    </create>
  </command>
</epp>`;
}

function resultCode(xml: string): string | undefined {
  return xml.match(/<result code="(\d+)">/)?.[1];
}

test("epp-02 greeting advertises domain/contact/host and mandatory extensions", () => {
  const xml = greeting("epp-testing-tool");
  assert.match(xml, /<svID>epp-testing-tool<\/svID>/);
  assert.match(xml, /<version>1\.0<\/version>/);
  assert.match(xml, /<lang>en<\/lang>/);
  assert.match(xml, /urn:ietf:params:xml:ns:domain-1.0/);
  assert.match(xml, /urn:ietf:params:xml:ns:contact-1.0/);
  assert.match(xml, /urn:ietf:params:xml:ns:host-1.0/);
  assert.match(xml, /urn:ietf:params:xml:ns:secDNS-1.1/);
  assert.match(xml, /urn:ietf:params:xml:ns:rgp-1.0/);
  assert.match(xml, /urn:ietf:params:xml:ns:launch-1.0/);
});

test("dashboard plaintext login succeeds while TLS still requires a client certificate", async () => {
  const handler = new AuthCommandHandler({
    authUsers: defaultAuthUsers,
    eppTlsRequireClientCert: true
  });
  const loginXml = `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><login><clID>melendez-admin</clID><pw>admin-secret</pw><options><version>1.0</version><lang>en</lang></options><svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs></login></command></epp>`;

  const dashboard = await handler.handle(parseEppXml(loginXml), {
    session: {
      id: "dash",
      authenticated: false,
      tls: false,
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: loginXml,
    transactionId: "dashboard-login"
  });
  assert.equal(resultCode(dashboard), "1000");

  const tlsNoCert = await handler.handle(parseEppXml(loginXml), {
    session: {
      id: "tls",
      authenticated: false,
      tls: true,
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: loginXml,
    transactionId: "rst-login"
  });
  assert.equal(resultCode(tlsNoCert), "2200");
});

test("epp-03 rejects unknown client and wrong password", async () => {
  const handler = new AuthCommandHandler({ authUsers: defaultAuthUsers, eppTlsRequireClientCert: false });
  const unknown = await handler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><login><clID>nobody</clID><pw>x</pw><options><version>1.0</version><lang>en</lang></options><svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs></login></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(unknown), "2200");

  const badPw = await handler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><login><clID>melendez-registrar</clID><pw>wrong</pw><options><version>1.0</version><lang>en</lang></options><svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs></login></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(badPw), "2200");
});

test("logout returns 1500", async () => {
  const handler = new AuthCommandHandler({ authUsers: defaultAuthUsers, eppTlsRequireClientCert: false });
  const response = await handler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><logout/></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(response), "1500");
});

test("epp-07 contact create validates id, country, email, voice and stores values", async () => {
  const { contactHandler } = registry();

  const ok = await contactHandler.handle(parseEppXml(contactCreateXml("sh8013")), ctx());
  assert.equal(resultCode(ok), "1000");

  const info = await contactHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><info><contact:info xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>sh8013</contact:id></contact:info></info></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(info), "1000");
  assert.match(info, /<contact:id>sh8013<\/contact:id>/);
  assert.match(info, /<contact:cc>US<\/contact:cc>/);
  assert.match(info, /-ICANNRST<\/contact:roid>/);
  assert.ok(isValidRoid(info.match(/<contact:roid>([^<]+)<\/contact:roid>/)?.[1] ?? ""));

  assert.equal(resultCode(await contactHandler.handle(parseEppXml(contactCreateXml("ab")), ctx())), "2005");
  assert.equal(resultCode(await contactHandler.handle(parseEppXml(contactCreateXml("toolongcontactid1")), ctx())), "2005");
  assert.equal(resultCode(await contactHandler.handle(parseEppXml(contactCreateXml("sh8014", { cc: "XX" })), ctx())), "2005");
  assert.equal(resultCode(await contactHandler.handle(parseEppXml(contactCreateXml("sh8015", { email: "not-an-email" })), ctx())), "2005");
  assert.equal(resultCode(await contactHandler.handle(parseEppXml(contactCreateXml("sh8016", { voice: "+12345" })), ctx())), "2005");
  assert.equal(resultCode(await contactHandler.handle(parseEppXml(contactCreateXml("sh8017", { type: "xx" })), ctx())), "2005");
});

test("epp-08 non-sponsoring registrar cannot info or update a contact", async () => {
  const { contactHandler } = registry();
  await contactHandler.handle(parseEppXml(contactCreateXml("owned1")), ctx("melendez-registrar"));

  const info = await contactHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><info><contact:info xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>owned1</contact:id></contact:info></info></command></epp>`
    ),
    ctx("melendez-tester")
  );
  assert.equal(resultCode(info), "2201");

  const update = await contactHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><update><contact:update xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>owned1</contact:id><contact:chg><contact:email>x@example.net</contact:email></contact:chg></contact:update></update></command></epp>`
    ),
    ctx("melendez-tester")
  );
  assert.equal(resultCode(update), "2201");
});

test("epp-11/12/23 host objects, glue policy, access control, and rename", async () => {
  const { domainHandler, contactHandler, hostHandler } = registry();
  await contactHandler.handle(parseEppXml(contactCreateXml("regc01")), ctx());
  await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>parent.melendez</domain:name><domain:registrant>regc01</domain:registrant><domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo></domain:create></create></command></epp>`
    ),
    ctx()
  );

  const external = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.example.net</host:name></host:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(external), "1000");

  const noParent = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.missing.melendez</host:name><host:addr ip="v4">208.77.190.196</host:addr></host:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(noParent), "2005");

  const internal = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.parent.melendez</host:name><host:addr ip="v4">208.77.190.196</host:addr></host:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(internal), "1000");

  const loopback = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns2.parent.melendez</host:name><host:addr ip="v4">127.0.0.1</host:addr></host:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(loopback), "2005");

  const badFamily = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns3.parent.melendez</host:name><host:addr ip="v5">208.77.190.196</host:addr></host:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(badFamily), "2005");

  const otherInfo = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><info><host:info xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.example.net</host:name></host:info></info></command></epp>`
    ),
    ctx("melendez-tester")
  );
  assert.equal(resultCode(otherInfo), "2201");

  const otherGlue = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns9.parent.melendez</host:name><host:addr ip="v4">208.77.190.197</host:addr></host:create></create></command></epp>`
    ),
    ctx("melendez-tester")
  );
  assert.equal(resultCode(otherGlue), "2201");

  const renameExternal = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><update><host:update xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.example.net</host:name><host:chg><host:name>ns1.example.org</host:name></host:chg></host:update></update></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(renameExternal), "1000");
});

test("epp-14/15/16/18/19/21 domain lifecycle with host objects, RGP, transfer, and linked delete", async () => {
  const { domainHandler, contactHandler, hostHandler, domains } = registry();
  await contactHandler.handle(parseEppXml(contactCreateXml("regc02")), ctx());
  await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.example.net</host:name></host:create></create></command></epp>`
    ),
    ctx()
  );

  const missingRegistrant = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>noreg.melendez</domain:name><domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo></domain:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(missingRegistrant), "2003");

  const hostAttr = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>attr.melendez</domain:name><domain:ns><domain:hostAttr><domain:hostName>ns1.attr.melendez</domain:hostName></domain:hostAttr></domain:ns><domain:registrant>regc02</domain:registrant><domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo></domain:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(hostAttr), "2005");

  const badPeriod = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>long.melendez</domain:name><domain:period unit="y">11</domain:period><domain:registrant>regc02</domain:registrant><domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo></domain:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(badPeriod), "2005");

  const badDs = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>badds.melendez</domain:name><domain:registrant>regc02</domain:registrant><domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo></domain:create></create><extension><secDNS:create xmlns:secDNS="urn:ietf:params:xml:ns:secDNS-1.1"><secDNS:dsData><secDNS:keyTag></secDNS:keyTag><secDNS:alg>13</secDNS:alg><secDNS:digestType>2</secDNS:digestType><secDNS:digest>${SHA256}</secDNS:digest></secDNS:dsData></secDNS:create></extension></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(badDs), "2005");

  const created = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name><domain:period unit="y">1</domain:period><domain:ns><domain:hostObj>ns1.example.net</domain:hostObj></domain:ns><domain:registrant>regc02</domain:registrant><domain:authInfo><domain:pw>secret-auth</domain:pw></domain:authInfo></domain:create></create><extension><secDNS:create xmlns:secDNS="urn:ietf:params:xml:ns:secDNS-1.1"><secDNS:dsData><secDNS:keyTag>12345</secDNS:keyTag><secDNS:alg>13</secDNS:alg><secDNS:digestType>2</secDNS:digestType><secDNS:digest>${SHA256}</secDNS:digest></secDNS:dsData></secDNS:create></extension></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(created), "1000");

  const info = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><info><domain:info xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name></domain:info></info></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(info), "1000");
  assert.match(info, /<domain:clID>melendez-registrar<\/domain:clID>/);
  assert.match(info, /<domain:crID>melendez-registrar<\/domain:crID>/);
  assert.match(info, /-ICANNRST<\/domain:roid>/);
  assert.match(info, /<rgp:rgpStatus s="addPeriod"/);
  assert.match(info, new RegExp(`<secDNS:digest>${SHA256}</secDNS:digest>`));

  const linkedHost = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><delete><host:delete xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.example.net</host:name></host:delete></delete></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(linkedHost), "2305");

  const linkedContact = await contactHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><delete><contact:delete xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>regc02</contact:id></contact:delete></delete></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(linkedContact), "2305");

  const otherUpdate = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><update><domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name><domain:add><domain:status s="clientHold"/></domain:add></domain:update></update></command></epp>`
    ),
    ctx("melendez-tester")
  );
  assert.equal(resultCode(otherUpdate), "2201");

  const domain = await domains.findByName("lifecycle.melendez");
  const renew = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><renew><domain:renew xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name><domain:curExpDate>${domain?.expiresAt.slice(0, 10)}</domain:curExpDate><domain:period unit="y">1</domain:period></domain:renew></renew></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(renew), "1000");
  const renewed = await domains.findByName("lifecycle.melendez");
  assert.equal(renewed?.rgpStatus, "renewPeriod");

  const tooLong = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><renew><domain:renew xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name><domain:curExpDate>${renewed?.expiresAt.slice(0, 10)}</domain:curExpDate><domain:period unit="y">10</domain:period></domain:renew></renew></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(tooLong), "2005");

  const transferBad = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><transfer op="request"><domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name><domain:period unit="y">1</domain:period><domain:authInfo><domain:pw>wrong</domain:pw></domain:authInfo></domain:transfer></transfer></command></epp>`
    ),
    ctx("melendez-tester")
  );
  assert.equal(resultCode(transferBad), "2202");

  const transferOk = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><transfer op="request"><domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name><domain:period unit="y">1</domain:period><domain:authInfo><domain:pw>secret-auth</domain:pw></domain:authInfo></domain:transfer></transfer></command></epp>`
    ),
    ctx("melendez-tester")
  );
  assert.equal(resultCode(transferOk), "1000");
  assert.ok((await domains.findByName("lifecycle.melendez"))?.statuses.includes("pendingTransfer"));

  const approve = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><transfer op="approve"><domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name></domain:transfer></transfer></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(approve), "1000");
  const transferred = await domains.findByName("lifecycle.melendez");
  assert.equal(transferred?.registrarId, "melendez-tester");
  assert.equal(transferred?.rgpStatus, "transferPeriod");
  assert.ok(!transferred?.statuses.includes("pendingTransfer"));

  const deleted = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><delete><domain:delete xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>lifecycle.melendez</domain:name></domain:delete></delete></command></epp>`
    ),
    ctx("melendez-tester")
  );
  assert.equal(resultCode(deleted), "1000");
  assert.equal(await domains.findByName("lifecycle.melendez"), null);

  const hostGone = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><delete><host:delete xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.example.net</host:name></host:delete></delete></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(hostGone), "1000");
});

test("epp-02 greeting has exactly one version 1.0 and required extensions", () => {
  const xml = greeting("epp-testing-tool");
  assert.equal((xml.match(/<version>/g) ?? []).length, 1);
  assert.match(xml, /<svDate>\d{4}-\d{2}-\d{2}T/);
  assert.match(xml, /<lang>en<\/lang>/);
});

test("epp-04/05/06 check returns avail 0/1 instead of failing the command", async () => {
  const { domainHandler, contactHandler, hostHandler } = registry();
  await contactHandler.handle(parseEppXml(contactCreateXml("chkc01")), ctx());
  await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>taken.melendez</domain:name><domain:registrant>chkc01</domain:registrant><domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo></domain:create></create></command></epp>`
    ),
    ctx()
  );
  await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.example.net</host:name></host:create></create></command></epp>`
    ),
    ctx()
  );

  const domainCheck = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><check><domain:check xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>taken.melendez</domain:name><domain:name>free-rst.melendez</domain:name><domain:name>nic.melendez</domain:name><domain:name>not a domain</domain:name></domain:check></check></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(domainCheck), "1000");
  assert.match(domainCheck, /<domain:name avail="0">taken\.melendez<\/domain:name>/);
  assert.match(domainCheck, /<domain:name avail="1">free-rst\.melendez<\/domain:name>/);
  assert.match(domainCheck, /<domain:name avail="0">nic\.melendez<\/domain:name>/);
  assert.match(domainCheck, /avail="0"/);

  const hostCheck = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><check><host:check xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.example.net</host:name><host:name>ns9.example.net</host:name><host:name>-bad.host</host:name></host:check></check></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(hostCheck), "1000");
  assert.match(hostCheck, /<host:name avail="0">ns1\.example\.net<\/host:name>/);
  assert.match(hostCheck, /<host:name avail="1">ns9\.example\.net<\/host:name>/);
  assert.match(hostCheck, /avail="0"/);

  const contactCheck = await contactHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><check><contact:check xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>chkc01</contact:id><contact:id>freeid99</contact:id><contact:id>ab</contact:id></contact:check></check></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(contactCheck), "1000");
  assert.match(contactCheck, /<contact:id avail="0">chkc01<\/contact:id>/);
  assert.match(contactCheck, /<contact:id avail="1">freeid99<\/contact:id>/);
  assert.match(contactCheck, /<contact:id avail="0">ab<\/contact:id>/);
});

test("epp-10/24 unlinked contact and host delete then info is 2303", async () => {
  const { contactHandler, hostHandler } = registry();
  await contactHandler.handle(parseEppXml(contactCreateXml("delc01")), ctx());
  await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns-delete.example.net</host:name></host:create></create></command></epp>`
    ),
    ctx()
  );

  assert.equal(
    resultCode(
      await contactHandler.handle(
        parseEppXml(
          `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><delete><contact:delete xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>delc01</contact:id></contact:delete></delete></command></epp>`
        ),
        ctx()
      )
    ),
    "1000"
  );
  assert.equal(
    resultCode(
      await contactHandler.handle(
        parseEppXml(
          `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><info><contact:info xmlns:contact="urn:ietf:params:xml:ns:contact-1.0"><contact:id>delc01</contact:id></contact:info></info></command></epp>`
        ),
        ctx()
      )
    ),
    "2303"
  );

  assert.equal(
    resultCode(
      await hostHandler.handle(
        parseEppXml(
          `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><delete><host:delete xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns-delete.example.net</host:name></host:delete></delete></command></epp>`
        ),
        ctx()
      )
    ),
    "1000"
  );
  assert.equal(
    resultCode(
      await hostHandler.handle(
        parseEppXml(
          `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><info><host:info xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns-delete.example.net</host:name></host:info></info></command></epp>`
        ),
        ctx()
      )
    ),
    "2303"
  );
});

test("epp-16 domain update of status, nameservers, and DS; other registrar is 2201", async () => {
  const { domainHandler, contactHandler, hostHandler } = registry();
  await contactHandler.handle(parseEppXml(contactCreateXml("updc01")), ctx());
  await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.update.net</host:name></host:create></create></command></epp>`
    ),
    ctx()
  );
  await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns2.update.net</host:name></host:create></create></command></epp>`
    ),
    ctx()
  );
  assert.equal(
    resultCode(
      await domainHandler.handle(
        parseEppXml(
          `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>update.melendez</domain:name><domain:ns><domain:hostObj>ns1.update.net</domain:hostObj></domain:ns><domain:registrant>updc01</domain:registrant><domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo></domain:create></create></command></epp>`
        ),
        ctx()
      )
    ),
    "1000"
  );

  const updated = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><update><domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>update.melendez</domain:name><domain:add><domain:ns><domain:hostObj>ns2.update.net</domain:hostObj></domain:ns><domain:status s="clientHold"/></domain:add><domain:rem><domain:ns><domain:hostObj>ns1.update.net</domain:hostObj></domain:ns></domain:rem></domain:update></update><extension><secDNS:update xmlns:secDNS="urn:ietf:params:xml:ns:secDNS-1.1"><secDNS:add><secDNS:dsData><secDNS:keyTag>12345</secDNS:keyTag><secDNS:alg>13</secDNS:alg><secDNS:digestType>2</secDNS:digestType><secDNS:digest>${SHA256}</secDNS:digest></secDNS:dsData></secDNS:add></secDNS:update></extension></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(updated), "1000");

  const info = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><info><domain:info xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>update.melendez</domain:name></domain:info></info></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(info), "1000");
  assert.match(info, /<domain:hostObj>ns2\.update\.net<\/domain:hostObj>/);
  assert.match(info, /<domain:status s="clientHold"/);
  assert.match(info, new RegExp(`<secDNS:digest>${SHA256}</secDNS:digest>`));
  assert.doesNotMatch(info, /ns1\.update\.net/);

  const hostAttrUpdate = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><update><domain:update xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>update.melendez</domain:name><domain:add><domain:ns><domain:hostAttr><domain:hostName>ns3.update.melendez</domain:hostName></domain:hostAttr></domain:ns></domain:add></domain:update></update></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(hostAttrUpdate), "2005");
});

test("epp-20 transfer reject leaves the original sponsor", async () => {
  const { domainHandler, contactHandler, domains } = registry();
  await contactHandler.handle(parseEppXml(contactCreateXml("rejc01")), ctx());
  await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>reject.melendez</domain:name><domain:registrant>rejc01</domain:registrant><domain:authInfo><domain:pw>secret-auth</domain:pw></domain:authInfo></domain:create></create></command></epp>`
    ),
    ctx()
  );

  assert.equal(
    resultCode(
      await domainHandler.handle(
        parseEppXml(
          `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><transfer op="request"><domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>reject.melendez</domain:name><domain:authInfo><domain:pw>secret-auth</domain:pw></domain:authInfo></domain:transfer></transfer></command></epp>`
        ),
        ctx("melendez-tester")
      )
    ),
    "1000"
  );

  const rejected = await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><transfer op="reject"><domain:transfer xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>reject.melendez</domain:name></domain:transfer></transfer></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(rejected), "1000");
  const domain = await domains.findByName("reject.melendez");
  assert.equal(domain?.registrarId, "melendez-registrar");
  assert.ok(!domain?.statuses.includes("pendingTransfer"));
});

test("epp-23 rename of a linked external host used by another registrar is 2305", async () => {
  const { domainHandler, contactHandler, hostHandler } = registry();
  await contactHandler.handle(parseEppXml(contactCreateXml("renc01")), ctx("melendez-tester"));
  await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.shared.net</host:name></host:create></create></command></epp>`
    ),
    ctx()
  );
  await domainHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><create><domain:create xmlns:domain="urn:ietf:params:xml:ns:domain-1.0"><domain:name>shared.melendez</domain:name><domain:ns><domain:hostObj>ns1.shared.net</domain:hostObj></domain:ns><domain:registrant>renc01</domain:registrant><domain:authInfo><domain:pw>pw</domain:pw></domain:authInfo></domain:create></create></command></epp>`
    ),
    ctx("melendez-tester")
  );

  const rename = await hostHandler.handle(
    parseEppXml(
      `<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><update><host:update xmlns:host="urn:ietf:params:xml:ns:host-1.0"><host:name>ns1.shared.net</host:name><host:chg><host:name>ns1.shared.org</host:name></host:chg></host:update></update></command></epp>`
    ),
    ctx()
  );
  assert.equal(resultCode(rename), "2305");
});
