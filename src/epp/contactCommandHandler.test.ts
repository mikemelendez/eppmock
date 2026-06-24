import test from "node:test";
import assert from "node:assert/strict";
import { ContactService } from "../contact/contactService.js";
import { InMemoryContactRepository } from "../contact/inMemoryContactRepository.js";
import { ContactCommandHandler } from "./contactCommandHandler.js";
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
    transactionId: "ctx-1"
  };
}

function handler(): ContactCommandHandler {
  return new ContactCommandHandler(new ContactService(new InMemoryContactRepository()));
}

const createXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <create>
      <contact:create xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
        <contact:postalInfo type="int">
          <contact:name>John Doe</contact:name>
          <contact:addr>
            <contact:street>123 Example Dr.</contact:street>
            <contact:city>Dulles</contact:city>
            <contact:cc>US</contact:cc>
          </contact:addr>
        </contact:postalInfo>
        <contact:email>jdoe@example.melendez</contact:email>
        <contact:authInfo><contact:pw>secret</contact:pw></contact:authInfo>
      </contact:create>
    </create>
    <clTRID>create-1</clTRID>
  </command>
</epp>`;

test("contact create then info returns the stored contact", async () => {
  const contactHandler = handler();

  const created = await contactHandler.handle(parseEppXml(createXml), context());
  assert.match(created, /<result code="1000">/);
  assert.match(created, /<contact:id>sh8013<\/contact:id>/);
  assert.match(created, /<clTRID>ctx-1<\/clTRID>/);

  const infoXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <contact:info xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
      </contact:info>
    </info>
  </command>
</epp>`;

  const info = await contactHandler.handle(parseEppXml(infoXml), context());
  assert.match(info, /<contact:infData/);
  assert.match(info, /<contact:email>jdoe@example.melendez<\/contact:email>/);
  assert.match(info, /<contact:city>Dulles<\/contact:city>/);
});

test("contact create twice returns object exists", async () => {
  const contactHandler = handler();
  await contactHandler.handle(parseEppXml(createXml), context());
  const second = await contactHandler.handle(parseEppXml(createXml), context());
  assert.match(second, /<result code="2302">/);
});

test("contact info for unknown id returns object does not exist", async () => {
  const infoXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <contact:info xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>missing</contact:id>
      </contact:info>
    </info>
  </command>
</epp>`;

  const info = await handler().handle(parseEppXml(infoXml), context());
  assert.match(info, /<result code="2303">/);
});

test("contact check reports availability", async () => {
  const contactHandler = handler();
  await contactHandler.handle(parseEppXml(createXml), context());

  const checkXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <contact:check xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
        <contact:id>free-id</contact:id>
      </contact:check>
    </check>
  </command>
</epp>`;

  const check = await contactHandler.handle(parseEppXml(checkXml), context());
  assert.match(check, /<contact:id avail="0">sh8013<\/contact:id>/);
  assert.match(check, /<contact:id avail="1">free-id<\/contact:id>/);
});
