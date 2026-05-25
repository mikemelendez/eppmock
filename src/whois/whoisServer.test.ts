import net from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import { DomainService } from "../domain/domainService.js";
import { InMemoryDomainRepository } from "../domain/inMemoryDomainRepository.js";
import { startWhoisServer } from "./whoisServer.js";

test("serves WHOIS queries over TCP", async () => {
  const domains = new DomainService(new InMemoryDomainRepository());
  await domains.create({
    name: "example.melendez",
    registrarId: "melendez-admin",
    nameservers: ["ns1.example.melendez"]
  });
  const server = startWhoisServer({ whoisHost: "127.0.0.1", whoisPort: 0, registryTld: "melendez" }, domains);

  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    const port = typeof address === "object" && address ? address.port : 0;
    const response = await whoisQuery(port, "example.melendez\r\n");

    assert.match(response, /Domain Name: example\.melendez/);
    assert.match(response, /Name Server: ns1\.example\.melendez/);
  } finally {
    server.close();
  }
});

function whoisQuery(port: number, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";

    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(query));
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
}
