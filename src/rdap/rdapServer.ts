import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { AppConfig } from "../config.js";
import type { ContactService } from "../contact/contactService.js";
import type { DomainService } from "../domain/domainService.js";
import { RegistryPolicy } from "../domain/registryPolicy.js";
import type { HostService } from "../host/hostService.js";
import {
  rdapContactEntity,
  rdapDomain,
  rdapError,
  rdapHelp,
  rdapNameserver,
  rdapRegistrarEntity
} from "./rdapMapper.js";

const RDAP_CONTENT_TYPE = "application/rdap+json";

export interface RdapServices {
  domains: DomainService;
  hosts: HostService;
  contacts: ContactService;
}

export async function startRdapServer(config: AppConfig, services: RdapServices): Promise<FastifyInstance> {
  const app = await buildRdapApp(config, services);

  await app.listen({ host: config.rdapHost, port: config.rdapPort });
  return app;
}

export async function buildRdapApp(config: AppConfig, services: RdapServices): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const policy = new RegistryPolicy(config.registryTld);
  const baseUrl = (request: { protocol: string; hostname: string }): string =>
    `${request.protocol}://${request.hostname}`;

  app.get("/help", async (request, reply) => {
    return rdap(reply, 200, rdapHelp(baseUrl(request)));
  });

  app.get<{ Params: { name: string } }>("/domain/:name", async (request, reply) => {
    const base = baseUrl(request);

    let canonicalName: string;
    let unicodeName: string;

    try {
      const normalized = policy.normalizeDomainName(request.params.name);
      canonicalName = normalized.canonicalName;
      unicodeName = normalized.unicodeName;
    } catch {
      return rdap(reply, 422, rdapError(422, "Unprocessable domain name", base));
    }

    const domain = await services.domains.findByName(canonicalName);

    if (!domain) {
      return rdap(reply, 404, rdapError(404, "Domain not found", base));
    }

    return rdap(reply, 200, rdapDomain(domain, base, { unicodeName }));
  });

  app.get<{ Params: { name: string } }>("/nameserver/:name", async (request, reply) => {
    const base = baseUrl(request);
    const host = await services.hosts.findByName(request.params.name);

    if (!host) {
      return rdap(reply, 404, rdapError(404, "Nameserver not found", base));
    }

    return rdap(reply, 200, rdapNameserver(host, base));
  });

  app.get<{ Params: { handle: string } }>("/entity/:handle", async (request, reply) => {
    const base = baseUrl(request);
    const handle = request.params.handle;

    const contact = await services.contacts.findById(handle);

    if (contact) {
      return rdap(reply, 200, rdapContactEntity(contact, base));
    }

    if (config.authUsers.some((user) => user.clid === handle)) {
      return rdap(reply, 200, rdapRegistrarEntity(handle, base));
    }

    return rdap(reply, 404, rdapError(404, "Entity not found", base));
  });

  app.setNotFoundHandler(async (request, reply) => {
    return rdap(reply, 400, rdapError(400, "Malformed or unsupported RDAP query", baseUrl(request)));
  });

  return app;
}

function rdap(reply: FastifyReply, statusCode: number, body: unknown): FastifyReply {
  return reply.code(statusCode).type(RDAP_CONTENT_TYPE).send(body);
}
