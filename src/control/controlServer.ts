import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DomainRecord } from "../domain/types.js";
import type { DomainService } from "../domain/domainService.js";
import type { CommandLogRepository } from "../epp/commandLogRepository.js";
import { sendEppRequest } from "../epp/eppClient.js";
import { dashboardHtml } from "./dashboardHtml.js";

const domainFixtureSchema = z.object({
  name: z.string().min(1),
  registrarId: z.string().min(1),
  periodYears: z.number().int().positive().default(1),
  statuses: z.array(z.string()).default(["ok"]),
  nameservers: z.array(z.string()).default([]),
  registrantContact: z.string().optional(),
  contacts: z
    .array(
      z.object({
        type: z.enum(["admin", "tech", "billing"]),
        id: z.string().min(1)
      })
    )
    .default([]),
  authInfo: z.string().optional(),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  updatedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().default(() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString();
  }),
  transfer: z
    .object({
      status: z.enum(["pending", "approved", "rejected", "cancelled"]),
      requestedBy: z.string().min(1),
      requestedAt: z.string().datetime(),
      updatedAt: z.string().datetime()
    })
    .optional()
});

const resetBodySchema = z.object({
  domains: z.array(domainFixtureSchema).default([])
});

const eppRequestBodySchema = z.object({
  xml: z.string().min(1),
  autoLogin: z.boolean().default(true),
  clid: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional()
});

const dnsZoneQuerySchema = z.object({
  download: z.coerce.boolean().default(false),
  dnssec: z.coerce.boolean().default(false),
  keyAction: z.enum(["generate", "renew"]).default("generate"),
  nsec3Hash: z.coerce.number().int().min(1).max(255).default(1),
  nsec3Flags: z.coerce.number().int().min(0).max(255).default(0),
  nsec3Iterations: z.coerce.number().int().min(0).max(2500).default(10),
  nsec3Salt: z
    .string()
    .regex(/^[A-Fa-f0-9-]+$/)
    .default("A1B2C3D4")
});

type DnsZoneOptions = Omit<z.infer<typeof dnsZoneQuerySchema>, "download">;

export async function startControlServer(
  config: AppConfig,
  domains: DomainService,
  commandLog: CommandLogRepository
): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  app.get("/", async (_request, reply) => {
    return reply.type("text/html").send(dashboardHtml());
  });

  app.get("/health", async () => ({
    ok: true,
    service: "epp-testing-tool"
  }));

  app.get("/auth/users", async () => config.authUsers);

  app.get("/domains", async () => domains.list());

  app.get("/domains.csv", async (_request, reply) => {
    const csv = domainsToCsv(await domains.list());
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="epp-domains-${dateStamp()}.csv"`)
      .send(csv);
  });

  app.get("/dns/zone", async (request, reply) => {
    const query = dnsZoneQuerySchema.parse(request.query);
    const zone = generateMelendezZone(await domains.list(), query);
    const response = reply.type("text/plain; charset=utf-8");

    if (query.download) {
      response.header("content-disposition", 'attachment; filename="melendez.zone"');
    }

    return response.send(zone);
  });

  app.post("/reset", async (request, reply) => {
    if (!isAuthorizedReset(request.headers.authorization, config)) {
      return unauthorized(reply);
    }

    const body = resetBodySchema.parse(request.body ?? {});
    await domains.reset(body.domains satisfies DomainRecord[]);
    commandLog.reset();
    return { ok: true };
  });

  app.post("/admin/domains/reset", async (request, reply) => {
    if (!isAuthorizedReset(request.headers.authorization, config)) {
      return unauthorized(reply);
    }

    await domains.reset([]);
    commandLog.reset();
    return { ok: true };
  });

  app.get("/commands", async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().positive().max(500).default(100)
      })
      .parse(request.query);

    return commandLog.list(query.limit);
  });

  app.post("/epp/request", async (request, reply) => {
    const body = eppRequestBodySchema.parse(request.body ?? {});

    try {
      return await sendEppRequest(config, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected EPP client error";
      return reply.code(502).send({ message });
    }
  });

  await app.listen({
    host: config.controlHost,
    port: config.controlPort
  });
}

function domainsToCsv(domains: DomainRecord[]): string {
  const headers = [
    "name",
    "registrarId",
    "periodYears",
    "statuses",
    "nameservers",
    "registrantContact",
    "contacts",
    "authInfo",
    "createdAt",
    "updatedAt",
    "expiresAt",
    "transfer"
  ];
  const rows = domains.map((domain) => [
    domain.name,
    domain.registrarId,
    String(domain.periodYears),
    JSON.stringify(domain.statuses),
    JSON.stringify(domain.nameservers),
    domain.registrantContact ?? "",
    JSON.stringify(domain.contacts),
    domain.authInfo ?? "",
    domain.createdAt,
    domain.updatedAt ?? "",
    domain.expiresAt,
    domain.transfer ? JSON.stringify(domain.transfer) : ""
  ]);

  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function generateMelendezZone(domains: DomainRecord[], options: DnsZoneOptions): string {
  const origin = "melendez.";
  const tldNameservers = ["ns1.melendez.", "ns2.melendez."];
  const serial = zoneSerial();
  const dnssecRecords = options.dnssec ? dnssecZoneRecords(options) : [];
  const delegations = domains
    .filter((domain) => domain.name.endsWith(".melendez"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((domain, index) => domainDelegationRecords(domain, index));

  return [
    `$ORIGIN ${origin}`,
    "$TTL 3600",
    `@ IN SOA ${tldNameservers[0]} hostmaster.${origin} (`,
    `  ${serial} ; serial`,
    "  3600       ; refresh",
    "  900        ; retry",
    "  1209600    ; expire",
    "  3600       ; minimum",
    ")",
    "",
    ...tldNameservers.map((nameserver) => `@ IN NS ${nameserver}`),
    "",
    "ns1 IN A 192.0.2.10",
    "ns2 IN A 192.0.2.11",
    "",
    ...dnssecRecords,
    "; Delegated .melendez domains",
    ...(delegations.length ? delegations : ["; No registered .melendez domains found"]),
    ""
  ].join("\n");
}

function dnssecZoneRecords(options: DnsZoneOptions): string[] {
  const ksk = dnsKey("KSK", options.keyAction);
  const zsk = dnsKey("ZSK", options.keyAction);
  const salt = options.nsec3Salt === "-" ? "-" : options.nsec3Salt.toUpperCase();

  return [
    `; DNSSEC ${options.keyAction === "renew" ? "renewal" : "generation"} metadata`,
    "; KSK: Key Signing Key, ZSK: Zone Signing Key",
    `@ IN DNSKEY 257 3 13 ${ksk.publicKey}`,
    `@ IN DNSKEY 256 3 13 ${zsk.publicKey}`,
    `@ IN DS ${ksk.keyTag} 13 2 ${dnsDigest(ksk.publicKey)}`,
    `@ IN NSEC3PARAM ${options.nsec3Hash} ${options.nsec3Flags} ${options.nsec3Iterations} ${salt}`,
    `; KSK key tag: ${ksk.keyTag}`,
    `; ZSK key tag: ${zsk.keyTag}`,
    ""
  ];
}

function dnsKey(type: "KSK" | "ZSK", action: "generate" | "renew"): { publicKey: string; keyTag: number } {
  const seed =
    action === "renew"
      ? randomBytes(48)
      : createHash("sha512").update(`melendez-${type.toLowerCase()}-stable-key`).digest();
  const publicKey = seed.toString("base64");
  return {
    publicKey,
    keyTag: keyTagFor(type, publicKey)
  };
}

function dnsDigest(publicKey: string): string {
  return createHash("sha256").update(`melendez.${publicKey}`).digest("hex").toUpperCase();
}

function keyTagFor(type: "KSK" | "ZSK", publicKey: string): number {
  const digest = createHash("sha256").update(`${type}:${publicKey}`).digest();
  return digest.readUInt16BE(0);
}

function domainDelegationRecords(domain: DomainRecord, index: number): string[] {
  const label = domain.name.replace(/\.melendez$/, "");
  const nameservers = domain.nameservers.length
    ? domain.nameservers.map(ensureTrailingDot)
    : [`ns1.${domain.name}.`, `ns2.${domain.name}.`];
  const records = [
    `; ${domain.name}`,
    ...nameservers.map((nameserver) => `${label} IN NS ${nameserver}`)
  ];

  for (const [nameserverIndex, nameserver] of nameservers.entries()) {
    const glueOwner = inBailiwickOwner(nameserver);

    if (glueOwner) {
      records.push(`${glueOwner} IN A 192.0.2.${100 + index * 2 + nameserverIndex}`);
    }
  }

  records.push("");
  return records;
}

function ensureTrailingDot(value: string): string {
  return value.endsWith(".") ? value : `${value}.`;
}

function inBailiwickOwner(nameserver: string): string | null {
  const normalized = nameserver.toLowerCase();

  if (!normalized.endsWith(".melendez.")) {
    return null;
  }

  return normalized.replace(/\.melendez\.$/, "");
}

function zoneSerial(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}01`;
}

function isAuthorizedReset(authorization: string | undefined, config: AppConfig): boolean {
  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");

  if (separatorIndex === -1) {
    return false;
  }

  const user = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  return safeEqual(user, config.resetHttpUser) && safeEqual(password, config.resetHttpPassword);
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function unauthorized(reply: {
  code(statusCode: number): {
    header(name: string, value: string): {
      send(payload: unknown): unknown;
    };
  };
}): unknown {
  return reply
    .code(401)
    .header("www-authenticate", 'Basic realm="EPP Testing Tool Reset"')
    .send({ message: "Reset requires HTTP Basic authentication" });
}
