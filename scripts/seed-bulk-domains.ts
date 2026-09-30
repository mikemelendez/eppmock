#!/usr/bin/env npx tsx
/**
 * Fast path for DNSSEC Operations: seed N delegated .melendez domains into SQLite
 * (or memory) without sending a huge /reset JSON payload.
 *
 * Examples:
 *   npx tsx scripts/seed-bulk-domains.ts --count 10000
 *   npx tsx scripts/seed-bulk-domains.ts --count 10000 --sqlite /app/data/epp-testing-tool.sqlite
 *   npx tsx scripts/seed-bulk-domains.ts --count 10000 --sqlite ./data/epp.sqlite --zone ./melendez.zone
 *   npx tsx scripts/seed-bulk-domains.ts --count 10000 --zone ./melendez.zone --registry ./registry.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { planBulkDomainSeed } from "../src/dns/bulkDomainSeed.js";
import { generateMelendezZone } from "../src/dns/melendezZone.js";
import { DomainService } from "../src/domain/domainService.js";
import { InMemoryDomainRepository } from "../src/domain/inMemoryDomainRepository.js";
import { SqliteDomainRepository } from "../src/domain/sqliteDomainRepository.js";
import { TldNameserverStore } from "../src/dns/tldNameservers.js";
import { buildRegistryExport, writeRegistryExport } from "../src/rdap/registryExport.js";

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const count = Number(arg("--count", "10000"));
const sqlitePath = arg("--sqlite");
const zonePath = arg("--zone");
const registryPath = arg("--registry");
const keyPath = arg("--keys", resolve("data/dnssec-keys.json"))!;
const nameserverPath = arg("--nameservers", resolve("data/tld-nameservers.json"))!;
const prefix = arg("--prefix", "d");

if (!Number.isInteger(count) || count < 1 || count > 50_000) {
  console.error(
    "Usage: npx tsx scripts/seed-bulk-domains.ts --count <1-50000> [--sqlite path] [--zone out.zone] [--registry registry.json]"
  );
  process.exit(1);
}

const repository = sqlitePath
  ? new SqliteDomainRepository(resolve(sqlitePath))
  : new InMemoryDomainRepository();
const domains = new DomainService(repository);
const existing = await domains.list();
const plan = planBulkDomainSeed(existing, { count, prefix });
await domains.reset(plan.all);

const total = (await domains.list()).length;
console.log(
  JSON.stringify(
    {
      ok: true,
      kept: plan.keep.length,
      generated: plan.generated.length,
      total,
      sqlite: sqlitePath ? resolve(sqlitePath) : null
    },
    null,
    2
  )
);

const listed = await domains.list();

if (zonePath || hasFlag("--zone")) {
  const out = resolve(zonePath || "melendez.zone");
  mkdirSync(dirname(out), { recursive: true });
  const zone = generateMelendezZone(
    listed,
    {
      dnssec: true,
      keyAction: "generate",
      nsec3Hash: 1,
      nsec3Flags: 0,
      nsec3Iterations: 0,
      nsec3Salt: "-"
    },
    { keyPath },
    [],
    new TldNameserverStore(nameserverPath).load()
  );
  writeFileSync(out, zone);
  console.log(JSON.stringify({ zone: out, bytes: Buffer.byteLength(zone) }, null, 2));
}

if (registryPath || hasFlag("--registry") || zonePath || hasFlag("--zone")) {
  const out = resolve(registryPath || "registry.json");
  const document = buildRegistryExport({ domains: listed });
  writeRegistryExport(out, document);
  console.log(JSON.stringify({ registry: out, domains: document.domains.length }, null, 2));
}
