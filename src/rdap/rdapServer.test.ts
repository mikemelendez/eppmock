import test from "node:test";
import assert from "node:assert/strict";
import { defaultAuthUsers, type AppConfig } from "../config.js";
import { ContactService } from "../contact/contactService.js";
import { InMemoryContactRepository } from "../contact/inMemoryContactRepository.js";
import { DomainService } from "../domain/domainService.js";
import { InMemoryDomainRepository } from "../domain/inMemoryDomainRepository.js";
import { HostService } from "../host/hostService.js";
import { InMemoryHostRepository } from "../host/inMemoryHostRepository.js";
import { buildRdapApp } from "./rdapServer.js";

function testConfig(): AppConfig {
  return {
    eppHost: "127.0.0.1",
    eppPort: 7000,
    eppMockHost: "127.0.0.1",
    eppMockPort: 7001,
    whoisHost: "127.0.0.1",
    whoisPort: 8043,
    controlHost: "127.0.0.1",
    controlPort: 8080,
    rdapHost: "127.0.0.1",
    rdapPort: 8090,
    greetingServerId: "epp-testing-tool",
    registryTld: "melendez",
    authUsers: defaultAuthUsers,
    resetHttpUser: "admin",
    resetHttpPassword: "test-reset-password",
    storageMode: "memory",
    sqlitePath: ":memory:",
    dnssecKeyPath: ":memory:"
  };
}

async function buildApp() {
  const domains = new DomainService(new InMemoryDomainRepository());
  const hosts = new HostService(new InMemoryHostRepository());
  const contacts = new ContactService(new InMemoryContactRepository());

  await domains.create({
    name: "example.melendez",
    registrarId: "melendez-registrar",
    nameservers: ["ns1.example.melendez"],
    dsRecords: [{ keyTag: 1, algorithm: 13, digestType: 2, digest: "ABCDEF" }]
  });
  await hosts.create({
    name: "ns1.example.melendez",
    registrarId: "melendez-registrar",
    addresses: [
      { ip: "192.0.2.1", version: "v4" },
      { ip: "2001:db8::1", version: "v6" }
    ]
  });
  await contacts.create({
    id: "sh8013",
    registrarId: "melendez-registrar",
    email: "jdoe@example.melendez",
    postalInfo: [{ type: "int", name: "John Doe", street: ["123 St"], city: "Dulles", cc: "US" }]
  });

  return buildRdapApp(testConfig(), { domains, hosts, contacts });
}

test("RDAP domain lookup returns an RFC 9083 domain object", async () => {
  const app = await buildApp();

  try {
    const response = await app.inject({ method: "GET", url: "/domain/example.melendez" });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-type"]), /application\/rdap\+json/);

    const body = response.json() as Record<string, unknown>;
    assert.equal(body.objectClassName, "domain");
    assert.equal(body.ldhName, "example.melendez");
    assert.ok(Array.isArray(body.rdapConformance));
    assert.ok((body.rdapConformance as string[]).includes("rdap_level_0"));
    assert.deepEqual((body.secureDNS as { delegationSigned: boolean }).delegationSigned, true);
  } finally {
    await app.close();
  }
});

test("RDAP domain not found returns 404 error object", async () => {
  const app = await buildApp();

  try {
    const response = await app.inject({ method: "GET", url: "/domain/missing.melendez" });
    assert.equal(response.statusCode, 404);
    const body = response.json() as Record<string, unknown>;
    assert.equal(body.errorCode, 404);
  } finally {
    await app.close();
  }
});

test("RDAP nameserver lookup returns ip addresses", async () => {
  const app = await buildApp();

  try {
    const response = await app.inject({ method: "GET", url: "/nameserver/ns1.example.melendez" });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { ipAddresses: { v4: string[]; v6: string[] } };
    assert.deepEqual(body.ipAddresses.v4, ["192.0.2.1"]);
    assert.deepEqual(body.ipAddresses.v6, ["2001:db8::1"]);
  } finally {
    await app.close();
  }
});

test("RDAP entity lookup resolves contacts and registrars", async () => {
  const app = await buildApp();

  try {
    const contact = await app.inject({ method: "GET", url: "/entity/sh8013" });
    assert.equal(contact.statusCode, 200);
    assert.equal((contact.json() as Record<string, unknown>).objectClassName, "entity");

    const registrar = await app.inject({ method: "GET", url: "/entity/melendez-registrar" });
    assert.equal(registrar.statusCode, 200);
    assert.deepEqual((registrar.json() as { roles: string[] }).roles, ["registrar"]);
  } finally {
    await app.close();
  }
});

test("RDAP help is available", async () => {
  const app = await buildApp();

  try {
    const response = await app.inject({ method: "GET", url: "/help" });
    assert.equal(response.statusCode, 200);
    assert.ok(Array.isArray((response.json() as { notices: unknown[] }).notices));
  } finally {
    await app.close();
  }
});
