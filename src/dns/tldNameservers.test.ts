import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { generateMelendezZone } from "./melendezZone.js";
import {
  DEFAULT_TLD_NAMESERVER_CONFIG,
  TldNameserverStore,
  parseTldNameserverConfig
} from "./tldNameservers.js";

test("TldNameserverStore persists glue and SOA overrides", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tld-ns-store-"));

  try {
    const store = new TldNameserverStore(join(tempDir, "tld-nameservers.json"));
    const loaded = store.load();
    assert.equal(loaded.ns1.a, DEFAULT_TLD_NAMESERVER_CONFIG.ns1.a);

    const saved = store.save({
      ns1: { a: "198.51.100.1", aaaa: "2001:db8:1::1" },
      ns2: { a: "198.51.100.2", aaaa: "2001:db8:1::2" },
      soaMname: "ns1.melendez.",
      soaRname: "hostmaster.ns1.melendez."
    });
    assert.equal(saved.ns1.a, "198.51.100.1");
    assert.ok(saved.updatedAt);

    const again = new TldNameserverStore(join(tempDir, "tld-nameservers.json")).load();
    assert.equal(again.ns2.aaaa, "2001:db8:1::2");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("parseTldNameserverConfig rejects invalid addresses", () => {
  assert.throws(
    () =>
      parseTldNameserverConfig({
        ...DEFAULT_TLD_NAMESERVER_CONFIG,
        ns1: { a: "not-an-ip", aaaa: DEFAULT_TLD_NAMESERVER_CONFIG.ns1.aaaa }
      }),
    /IPv4/
  );
});

test("zone output uses overridden nameserver glue and SOA", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tld-ns-zone-"));

  try {
    const zone = generateMelendezZone(
      [],
      {
        dnssec: false,
        keyAction: "generate",
        nsec3Hash: 1,
        nsec3Flags: 0,
        nsec3Iterations: 0,
        nsec3Salt: "-"
      },
      { keyPath: join(tempDir, "keys.json") },
      [],
      {
        ns1: { a: "203.0.113.50", aaaa: "2001:db8:50::1" },
        ns2: { a: "203.0.113.51", aaaa: "2001:db8:51::1" },
        soaMname: "ns2.melendez.",
        soaRname: "ops.ns2.melendez."
      }
    );

    assert.match(zone, /@ IN SOA ns2\.melendez\. ops\.ns2\.melendez\. \(/);
    assert.match(zone, /ns1 IN A 203\.0\.113\.50/);
    assert.match(zone, /ns2 IN AAAA 2001:db8:51::1/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
