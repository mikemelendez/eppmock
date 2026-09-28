import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { defaultAuthUsers, type AppConfig } from "../config.js";
import { DomainService } from "../domain/domainService.js";
import { InMemoryDomainRepository } from "../domain/inMemoryDomainRepository.js";
import { CommandLogRepository } from "../epp/commandLogRepository.js";
import { EppFrameDecoder, encodeFrame } from "../epp/framing.js";
import { greeting } from "../epp/responses.js";
import { buildControlApp } from "./controlServer.js";

test("serves downloadable signed zones and CSV with DS records", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "epp-control-"));
  const domains = new DomainService(new InMemoryDomainRepository());
  await domains.create({
    name: "signed.melendez",
    registrarId: "melendez-admin",
    nameservers: ["ns1.signed.melendez"],
    dsRecords: [
      {
        keyTag: 12345,
        algorithm: 13,
        digestType: 2,
        digest: "ABCDEF"
      }
    ]
  });

  const app = await buildControlApp(
    testConfig(join(tempDir, "dnssec-keys.json"), {
      tldNameserverPath: join(tempDir, "tld-nameservers.json")
    }),
    domains,
    new CommandLogRepository()
  );

  try {
    const zoneResponse = await app.inject({
      method: "GET",
      url: "/dns/zone?download=true&dnssec=true&nsec3Iterations=1"
    });

    assert.equal(zoneResponse.statusCode, 200);
    assert.equal(zoneResponse.headers["content-disposition"], 'attachment; filename="melendez.zone"');
    assert.match(zoneResponse.body, /@ IN DNSKEY 257 3 13 /);
    assert.match(zoneResponse.body, /signed IN DS 12345 13 2 ABCDEF/);
    assert.match(zoneResponse.body, / IN RRSIG /);

    const csvResponse = await app.inject({ method: "GET", url: "/domains.csv" });
    assert.equal(csvResponse.statusCode, 200);
    assert.match(csvResponse.body, /"dsRecords"/);
    assert.match(csvResponse.body, /12345/);
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("GET/PUT /dns/nameservers updates glue and SOA used by /dns/zone", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "epp-ns-"));
  const domains = new DomainService(new InMemoryDomainRepository());
  const app = await buildControlApp(
    testConfig(join(tempDir, "dnssec-keys.json"), {
      tldNameserverPath: join(tempDir, "tld-nameservers.json")
    }),
    domains,
    new CommandLogRepository()
  );
  const auth = `Basic ${Buffer.from("admin:test-reset-password").toString("base64")}`;

  try {
    const initial = await app.inject({ method: "GET", url: "/dns/nameservers" });
    assert.equal(initial.statusCode, 200);
    assert.match(initial.json().soaMname, /ns1\.melendez\./);

    const unauthorized = await app.inject({
      method: "PUT",
      url: "/dns/nameservers",
      payload: {
        ns1: { a: "203.0.113.10", aaaa: "2001:db8::10" },
        ns2: { a: "203.0.113.11", aaaa: "2001:db8::11" },
        soaMname: "ns1.melendez.",
        soaRname: "hostmaster.ns1.melendez."
      }
    });
    assert.equal(unauthorized.statusCode, 401);

    const updated = await app.inject({
      method: "PUT",
      url: "/dns/nameservers",
      headers: { authorization: auth },
      payload: {
        ns1: { a: "203.0.113.10", aaaa: "2001:db8::10" },
        ns2: { a: "203.0.113.11", aaaa: "2001:db8::11" },
        soaMname: "ns2.melendez.",
        soaRname: "ops.ns2.melendez."
      }
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().ns1.a, "203.0.113.10");

    const zone = await app.inject({ method: "GET", url: "/dns/zone?dnssec=false" });
    assert.equal(zone.statusCode, 200);
    assert.match(zone.body, /@ IN SOA ns2\.melendez\. ops\.ns2\.melendez\. \(/);
    assert.match(zone.body, /ns1 IN A 203\.0\.113\.10/);
    assert.match(zone.body, /ns1 IN AAAA 2001:db8::10/);
    assert.match(zone.body, /ns2 IN A 203\.0\.113\.11/);
    assert.match(zone.body, /ns2 IN AAAA 2001:db8::11/);
  } finally {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("hello EPP request returns one greeting frame without auto login", async () => {
  const fakeEpp = await startFakeGreetingServer();
  const domains = new DomainService(new InMemoryDomainRepository());
  const app = await buildControlApp(
    testConfig(":memory:", {
      eppHost: "127.0.0.1",
      eppPort: fakeEpp.port
    }),
    domains,
    new CommandLogRepository()
  );

  try {
    const response = await app.inject({
      method: "POST",
      url: "/epp/request",
      headers: {
        "content-type": "application/json"
      },
      payload: {
        xml: '<?xml version="1.0" encoding="UTF-8"?><epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><hello/></epp>'
      }
    });
    const body = response.json() as { frames: Array<{ type: string; xml: string }> };

    assert.equal(response.statusCode, 200);
    assert.equal(body.frames.length, 1);
    assert.equal(body.frames[0].type, "greeting");
    assert.match(body.frames[0].xml, /<greeting>/);
    assert.match(body.frames[0].xml, /<dcp>/);
    assert.doesNotMatch(body.frames[0].xml, /dashboard-login/);
    assert.equal(fakeEpp.receivedFrames(), 0);
  } finally {
    await app.close();
    await fakeEpp.close();
  }
});

function testConfig(dnssecKeyPath: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    eppHost: "127.0.0.1",
    eppPort: 7000,
    whoisHost: "127.0.0.1",
    whoisPort: 8043,
    controlHost: "127.0.0.1",
    controlPort: 8080,
    rdapHost: "127.0.0.1",
    rdapPort: 8090,
    greetingServerId: "epp-testing-tool",
    registryTld: "melendez",
    authUsers: defaultAuthUsers,
    resetHttpUser: "admin",
    resetHttpPassword: "test-reset-password",
    storageMode: "memory",
    sqlitePath: ":memory:",
    dnssecKeyPath,
    tldNameserverPath: join(tmpdir(), "tld-nameservers-test.json"),
    repositoryId: "ICANNRST",
    eppTlsRequireClientCert: false,
    ...overrides
  };
}

async function startFakeGreetingServer(): Promise<{
  port: number;
  receivedFrames: () => number;
  close: () => Promise<void>;
}> {
  const decoder = new EppFrameDecoder();
  let receivedFrames = 0;
  const server = net.createServer((socket) => {
    socket.write(encodeFrame(greeting("test-epp")));
    socket.on("data", (chunk) => {
      receivedFrames += decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).length;
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Unable to start fake EPP server");
  }

  return {
    port: address.port,
    receivedFrames: () => receivedFrames,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}
