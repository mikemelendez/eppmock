import { createHash } from "node:crypto";
import { allocateRoid, getRepositoryId } from "../epp/roid.js";
import { DEFAULT_REGISTRY_DOMAIN_NAMES } from "../registry/defaultRegistry.js";
import type { DomainRecord } from "../domain/types.js";

export interface BulkDomainSeedOptions {
  /** How many DNSSEC-ops domains to create (not counting reserved defaults). */
  count: number;
  /** Label prefix before the zero-padded index, e.g. `d` → d00001.melendez */
  prefix?: string;
  /** Registrar that sponsors the generated domains. */
  registrarId?: string;
  /** Keep these names when rebuilding the table (defaults: nic/miguel/example). */
  keepNames?: readonly string[];
}

export interface BulkDomainSeedPlan {
  keep: DomainRecord[];
  generated: DomainRecord[];
  all: DomainRecord[];
}

const DEFAULT_PREFIX = "d";
const DEFAULT_REGISTRAR = "melendez-admin";

/**
 * Build a full domain table for DNSSEC Operations stress: reserved defaults plus
 * `count` delegated names with DS (alg 13 / digest type 2) and dual in-bailiwick NS.
 */
export function planBulkDomainSeed(
  existing: DomainRecord[],
  options: BulkDomainSeedOptions
): BulkDomainSeedPlan {
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 50_000) {
    throw new Error("count must be an integer between 1 and 50000");
  }

  const prefix = (options.prefix ?? DEFAULT_PREFIX).toLowerCase().replace(/[^a-z0-9-]/g, "") || DEFAULT_PREFIX;
  const registrarId = options.registrarId ?? DEFAULT_REGISTRAR;
  const keepNames = new Set(
    (options.keepNames ?? DEFAULT_REGISTRY_DOMAIN_NAMES).map((name) => name.toLowerCase())
  );
  const keep = existing.filter((domain) => keepNames.has(domain.name.toLowerCase()));
  const pad = Math.max(5, String(options.count).length);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const generated: DomainRecord[] = [];

  for (let index = 1; index <= options.count; index += 1) {
    const label = `${prefix}${String(index).padStart(pad, "0")}`;
    const name = `${label}.melendez`;

    if (keepNames.has(name)) {
      continue;
    }

    generated.push({
      name,
      registrarId,
      creatorId: registrarId,
      roid: bulkRoid(index),
      periodYears: 1,
      statuses: ["ok"],
      nameservers: [`ns1.${name}`, `ns2.${name}`],
      contacts: [],
      authInfo: "bulk-dnssec-ops",
      dsRecords: [stableDs(name, index)],
      createdAt,
      expiresAt
    });
  }

  const all = [...keep, ...generated].sort((a, b) => a.name.localeCompare(b.name));
  return { keep, generated, all };
}

function bulkRoid(index: number): string {
  const local = `D${String(index).padStart(10, "0")}`;
  const roid = `${local}-${getRepositoryId()}`;

  if (roid.length > 89) {
    return allocateRoid("D");
  }

  return roid;
}

function stableDs(name: string, index: number): DomainRecord["dsRecords"][number] {
  const digest = createHash("sha256").update(`dnssec-ops:${name}`).digest("hex").toUpperCase();
  const keyTag = (createHash("sha256").update(`keytag:${name}:${index}`).digest().readUInt16BE(0) % 65534) + 1;
  return { keyTag, algorithm: 13, digestType: 2, digest };
}
