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
    assert.ok(await services.hosts.findByName(`ns1.${name}`));
    assert.ok(await services.hosts.findByName(`ns2.${name}`));
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

    assert.match(zone, /nic IN NS ns1\.nic\.melendez\./);
    assert.match(zone, /miguel IN NS ns1\.miguel\.melendez\./);
    assert.match(zone, /example IN NS ns1\.example\.melendez\./);
    assert.match(zone, /ns1\.nic IN A 192\.0\.2\.20/);
    assert.match(zone, /ns1\.nic IN AAAA 2001:db8:1::20/);
    assert.match(zone, /nic IN DS \d+ 13 2 [A-F0-9]{64}/);
    assert.match(zone, /@ IN DNSKEY 257 3 13 /);
    assert.match(zone, /@ IN NSEC3PARAM 1 0 0 -/);
    assert.match(zone, / IN RRSIG NS 13 /);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
