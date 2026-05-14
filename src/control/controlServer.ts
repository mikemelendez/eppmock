import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { DomainRecord } from "../domain/types.js";
import type { DomainService } from "../domain/domainService.js";
import type { CommandLogRepository } from "../epp/commandLogRepository.js";
import { sendEppRequest } from "../epp/eppClient.js";
import { generateMelendezZone } from "../dns/melendezZone.js";
import type { DnsZoneOptions } from "../dns/types.js";
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
  dsRecords: z
    .array(
      z.object({
        keyTag: z.number().int().positive(),
        algorithm: z.number().int().positive(),
        digestType: z.number().int().positive(),
        digest: z.string().min(1)
      })
    )
    .default([]),
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

export async function startControlServer(
  config: AppConfig,
  domains: DomainService,
  commandLog: CommandLogRepository
): Promise<void> {
  const app = await buildControlApp(config, domains, commandLog);

  await app.listen({
    host: config.controlHost,
    port: config.controlPort
  });
}

export async function buildControlApp(
  config: AppConfig,
  domains: DomainService,
  commandLog: CommandLogRepository
): Promise<FastifyInstance> {
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
    const zone = generateMelendezZone(await domains.list(), query satisfies DnsZoneOptions, {
      keyPath: config.dnssecKeyPath
    });
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

  return app;
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
    "dsRecords",
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
    JSON.stringify(domain.dsRecords),
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
