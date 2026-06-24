import test from "node:test";
import assert from "node:assert/strict";
import { HostService } from "../host/hostService.js";
import { InMemoryHostRepository } from "../host/inMemoryHostRepository.js";
import { HostCommandHandler } from "./hostCommandHandler.js";
import type { CommandContext } from "./types.js";
import { parseEppXml } from "./xml.js";

function context(): CommandContext {
  return {
    session: {
      id: "test-session",
      authenticated: true,
      clid: "melendez-registrar",
      connectedAt: new Date(),
      lastCommandAt: new Date()
    },
    rawXml: "",
    transactionId: "host-ctx"
  };
}

function handler(): HostCommandHandler {
  return new HostCommandHandler(new HostService(new InMemoryHostRepository()));
}

function createXml(name: string, addr: string, version: "v4" | "v6"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <host:create xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>${name}</host:name>
        <host:addr ip="${version}">${addr}</host:addr>
      </host:create>
    </create>
  </command>
</epp>`;
}

test("host create stores IPv4 and IPv6 glue and info returns them", async () => {
  const hostHandler = handler();

  const v4 = await hostHandler.handle(parseEppXml(createXml("ns1.example.melendez", "192.0.2.5", "v4")), context());
  assert.match(v4, /<result code="1000">/);
  assert.match(v4, /<host:name>ns1.example.melendez<\/host:name>/);

  const updateXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <host:update xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>ns1.example.melendez</host:name>
        <host:add>
          <host:addr ip="v6">2001:db8::1</host:addr>
        </host:add>
      </host:update>
    </update>
  </command>
</epp>`;
  await hostHandler.handle(parseEppXml(updateXml), context());

  const infoXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <host:info xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>ns1.example.melendez</host:name>
      </host:info>
    </info>
  </command>
</epp>`;
  const info = await hostHandler.handle(parseEppXml(infoXml), context());
  assert.match(info, /<host:addr ip="v4">192.0.2.5<\/host:addr>/);
  assert.match(info, /<host:addr ip="v6">2001:db8::1<\/host:addr>/);
});

test("host create rejects address that does not match declared IP family", async () => {
  const response = await handler().handle(
    parseEppXml(createXml("ns2.example.melendez", "2001:db8::99", "v4")),
    context()
  );
  assert.match(response, /<result code="2005">/);
});

test("host info for unknown host returns object does not exist", async () => {
  const infoXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <host:info xmlns:host="urn:ietf:params:xml:ns:host-1.0">
        <host:name>ns9.example.melendez</host:name>
      </host:info>
    </info>
  </command>
</epp>`;
  const info = await handler().handle(parseEppXml(infoXml), context());
  assert.match(info, /<result code="2303">/);
});
