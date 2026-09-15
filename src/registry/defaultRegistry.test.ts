import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ContactService } from "../contact/contactService.js";
import { InMemoryContactRepository } from "../contact/inMemoryContactRepository.js";
import { DomainService } from "../domain/domainService.js";
import { InMemoryDomainRepository } from "../domain/inMemoryDomainRepository.js";
import { HostService } from "../host/hostService.js";
import { InMemoryHostRepository } from "../host/inMemoryHostRepository.js";
import { RegistryLinks } from "./registryLinks.js";
import { DEFAULT_REGISTRY_DOMAIN_NAMES, ensureDefaultRegistry } from "./defaultRegistry.js";
import { generateMelendezZone } from "../dns/melendezZone.js";

function registry() {
  const links = new RegistryLinks();
  const domains = new DomainService(new InMemoryDomainRepository(), "melendez", links);
  const contacts = new ContactService(new InMemoryContactRepository(), links);
  const hosts = new HostService(new InMemoryHostRepository(), "melendez", links);
  links.domains = domains;
  links.contacts = contacts;
  links.hosts = hosts;
  return { domains, contacts, hosts };
}

test("seeds nic, miguel, and example with glue, DS, and a signed zone", async () => {
  const services = registry();
  await ensureDefaultRegistry(services);
  await ensureDefaultRegistry(services);

  const names = (await services.domains.list()).map((domain) => domain.name).sort();
  assert.deepEqual(names, [...DEFAULT_REGISTRY_DOMAIN_NAMES].sort());

  for (const name of DEFAULT_REGISTRY_DOMAIN_NAMES) {
    const domain = await services.domains.findByName(name);
    assert.ok(domain);
    assert.equal(domain.registrarId, "melendez-admin");
    assert.ok(domain.nameservers.includes(`ns1.${name}`));
    assert.ok(domain.nameservers.includes(`ns2.${name}`));
    assert.equal(domain.dsRecords.length, 1);
    assert.equal(domain.dsRecords[0]?.algorithm, 13);
    assert.equal(domain.dsRecords[0]?.digestType, 2);
    assert.equal(domain.dsRecords[0]?.digest.length, 64);
    assert.ok(domain.statuses.includes("serverDeleteProhibited"));
    const ns1 = await services.hosts.findByName(`ns1.${name}`);
    const ns2 = await services.hosts.findByName(`ns2.${name}`);
    assert.ok(ns1?.addresses.some((address) => address.version === "v6"));
    assert.ok(ns2?.addresses.some((address) => address.version === "v6"));
  }

  const nic = await services.hosts.findByName("ns1.nic.melendez");
  assert.deepEqual(
    nic?.addresses.map((address) => address.ip).sort(),
    ["192.0.2.20", "2001:db8:1::20"].sort()
  );

  const tempDir = mkdtempSync(join(tmpdir(), "default-zone-"));
  try {
    const zone = generateMelendezZone(
      await services.domains.list(),
      {
        dnssec: true,
        keyAction: "generate",
        nsec3Hash: 1,
        nsec3Flags: 0,
        nsec3Iterations: 0,
        nsec3Salt: "-"
      },
      { keyPath: join(tempDir, "dnssec-keys.json") },
      await services.hosts.list()
    );

    assert.match(zone, /ns1 IN A 192\.0\.2\.10/);
    assert.match(zone, /ns1 IN AAAA 2001:db8:53::1/);
    assert.match(zone, /ns2 IN A 192\.0\.2\.11/);
    assert.match(zone, /ns2 IN AAAA 2001:db8:53::2/);
    assert.match(zone, /nic IN NS ns1\.nic\.melendez\./);
    assert.match(zone, /miguel IN NS ns1\.miguel\.melendez\./);
    assert.match(zone, /example IN NS ns1\.example\.melendez\./);
    assert.match(zone, /nic IN A 192\.0\.2\.80/);
    assert.match(zone, /nic IN AAAA 2001:db8:1::80/);
    assert.match(zone, /miguel IN A 192\.0\.2\.81/);
    assert.match(zone, /miguel IN AAAA 2001:db8:1::81/);
    assert.match(zone, /example IN A 192\.0\.2\.82/);
    assert.match(zone, /example IN AAAA 2001:db8:1::82/);
    assert.match(zone, /ns1\.nic IN A 192\.0\.2\.20/);
    assert.match(zone, /ns1\.nic IN AAAA 2001:db8:1::20/);
    assert.match(zone, /ns2\.nic IN AAAA 2001:db8:1::21/);
    assert.match(zone, /ns1\.miguel IN AAAA 2001:db8:1::30/);
    assert.match(zone, /ns1\.example IN AAAA 2001:db8:1::40/);
    assert.match(zone, /nic IN DS \d+ 13 2 [A-F0-9]{64}/);
    assert.match(zone, /@ IN DNSKEY 257 3 13 /);
    assert.match(zone, /@ IN NSEC3PARAM 1 0 0 -/);
    assert.match(zone, / IN RRSIG NS 13 /);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("backfills AAAA glue on existing default hosts", async () => {
  const services = registry();
  await ensureDefaultRegistry(services);
  await services.hosts.update("ns1.nic.melendez", "melendez-admin", {
    addressesToRemove: [{ ip: "2001:db8:1::20", version: "v6" }]
  });

  const before = await services.hosts.findByName("ns1.nic.melendez");
  assert.equal(before?.addresses.some((address) => address.version === "v6"), false);

  await ensureDefaultRegistry(services);

  const after = await services.hosts.findByName("ns1.nic.melendez");
  assert.deepEqual(
    after?.addresses.map((address) => address.ip).sort(),
    ["192.0.2.20", "2001:db8:1::20"].sort()
  );
});

test("registrars still cannot create reserved nic.melendez", async () => {
  const services = registry();
  await ensureDefaultRegistry(services);
  await assert.rejects(() =>
    services.domains.create({
      name: "nic.melendez",
      registrarId: "melendez-registrar",
      registrantContact: "NIC-001"
    })
  );
});
