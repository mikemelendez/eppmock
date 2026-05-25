import net from "node:net";
import type { AppConfig } from "../config.js";
import { RegistryPolicyError } from "../domain/domainService.js";
import type { DomainService } from "../domain/domainService.js";
import { RegistryPolicy } from "../domain/registryPolicy.js";
import { formatWhoisResponse } from "./whoisFormatter.js";

export function startWhoisServer(
  config: Pick<AppConfig, "whoisHost" | "whoisPort" | "registryTld">,
  domains: DomainService
): net.Server {
  const policy = new RegistryPolicy(config.registryTld);
  const server = net.createServer((socket) => {
    let buffer = "";

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;

      if (buffer.includes("\n")) {
        void handleQuery(buffer, socket, domains, policy, config.registryTld);
      }
    });
    socket.on("end", () => {
      if (buffer.trim()) {
        void handleQuery(buffer, socket, domains, policy, config.registryTld);
      }
    });
  });

  server.listen(config.whoisPort, config.whoisHost, () => {
    console.log(`WHOIS listening on ${config.whoisHost}:${config.whoisPort}`);
  });

  return server;
}

async function handleQuery(
  rawQuery: string,
  socket: net.Socket,
  domains: DomainService,
  policy: RegistryPolicy,
  registryTld: string
): Promise<void> {
  const query = rawQuery.split(/\r?\n/)[0].trim();

  if (!query) {
    socket.end("% Empty WHOIS query\r\n");
    return;
  }

  try {
    const normalized = policy.normalizeDomainName(query);
    const domain = await domains.findByName(normalized.canonicalName);
    socket.end(formatWhoisResponse(query, domain, registryTld).response);
  } catch (error) {
    if (error instanceof RegistryPolicyError) {
      socket.end(formatWhoisResponse(query, null, registryTld).response);
      return;
    }

    socket.destroy(error instanceof Error ? error : new Error("Unexpected WHOIS error"));
  }
}
