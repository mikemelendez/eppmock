import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIPv4, isIPv6 } from "node:net";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export interface NameserverAddresses {
  owner: "ns1" | "ns2";
  a: string;
  aaaa: string;
}

export interface TldNameserverConfig {
  ns1: { a: string; aaaa: string };
  ns2: { a: string; aaaa: string };
  /** SOA MNAME, FQDN with trailing dot. */
  soaMname: string;
  /** SOA RNAME, FQDN with trailing dot (e.g. hostmaster.ns1.melendez.). */
  soaRname: string;
  updatedAt?: string;
}

const nameserverAddressSchema = z.object({
  a: z.string().min(1).refine(isIPv4, "Must be a valid IPv4 address"),
  aaaa: z.string().min(1).refine(isIPv6, "Must be a valid IPv6 address")
});

const fqdnSchema = z
  .string()
  .min(3)
  .regex(/^[a-z0-9_.-]+\.$/i, "Must be a DNS name ending with a trailing dot");

export const tldNameserverConfigSchema = z.object({
  ns1: nameserverAddressSchema,
  ns2: nameserverAddressSchema,
  soaMname: fqdnSchema,
  soaRname: fqdnSchema,
  updatedAt: z.string().datetime().optional()
});

/** Built-in defaults (current production glue). */
export const DEFAULT_TLD_NAMESERVER_CONFIG: TldNameserverConfig = {
  ns1: {
    a: "52.200.129.52",
    aaaa: "2600:1f18:79c4:5a00:91f7:3bf2:f396:c7c9"
  },
  ns2: {
    a: "67.217.246.69",
    aaaa: "2607:f1c0:f07e:9100::1"
  },
  soaMname: "ns1.melendez.",
  soaRname: "hostmaster.ns1.melendez."
};

/** @deprecated Prefer resolveTldNameserverAddresses(config). Kept for callers that only need defaults. */
export const TLD_NAMESERVER_ADDRESSES: readonly NameserverAddresses[] =
  resolveTldNameserverAddresses(DEFAULT_TLD_NAMESERVER_CONFIG);

export function resolveTldNameserverAddresses(config: TldNameserverConfig): NameserverAddresses[] {
  return [
    { owner: "ns1", a: config.ns1.a, aaaa: config.ns1.aaaa },
    { owner: "ns2", a: config.ns2.a, aaaa: config.ns2.aaaa }
  ];
}

export function parseTldNameserverConfig(input: unknown): TldNameserverConfig {
  return tldNameserverConfigSchema.parse(input);
}

export class TldNameserverStore {
  constructor(private readonly configPath: string) {}

  load(): TldNameserverConfig {
    const absolutePath = resolve(this.configPath);

    if (!existsSync(absolutePath)) {
      return { ...DEFAULT_TLD_NAMESERVER_CONFIG };
    }

    const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
    return parseTldNameserverConfig({
      ...DEFAULT_TLD_NAMESERVER_CONFIG,
      ...(parsed as object)
    });
  }

  save(input: unknown): TldNameserverConfig {
    const config = parseTldNameserverConfig({
      ...parseTldNameserverConfig(input),
      updatedAt: new Date().toISOString()
    });
    const absolutePath = resolve(this.configPath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    return config;
  }
}
