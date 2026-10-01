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

test("contact create policy errors include the failing field", async () => {
  const withVoice = createXml.replace(
    "</contact:postalInfo>",
    `</contact:postalInfo>\n        <contact:voice>+1 703 555 5555</contact:voice>`
  );
  const accentInt = createXml.replace("John Doe", "Mike Meléndez");

  const voice = await handler().handle(parseEppXml(withVoice), context());
  assert.match(voice, /<result code="2005">/);
  assert.match(voice, /<reason>Contact voice is invalid<\/reason>/);
  // RST schema requires <value> to contain a child element (not <value/>).
  assert.match(voice, /<value>\s*<undef>Contact voice is invalid<\/undef>\s*<\/value>/);
  assert.match(voice, /xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"/);

  const name = await handler().handle(parseEppXml(accentInt), context());
  assert.match(name, /<result code="2005">/);
  assert.match(name, /int postalInfo must contain ASCII characters only/);
});

test("contact create accepts RFC 5733 e164 voice with extension attribute", async () => {
  // RST epp-07 sends +1.NNNNNNNNNN; fast-xml-parser must not coerce it to a float.
  const contactHandler = handler();
  const withE164 = createXml
    .replace("sh8013", "sh8018")
    .replace(
      "</contact:postalInfo>",
      `</contact:postalInfo>\n        <contact:voice x="3468">+1.2742995934</contact:voice>\n        <contact:fax x="0335">+1.9834563624</contact:fax>`
    );

  const created = await contactHandler.handle(parseEppXml(withE164), context());
  assert.match(created, /<result code="1000">/);
  assert.match(created, /xmlns:xsi="http:\/\/www\.w3\.org\/2001\/XMLSchema-instance"/);

  const infoXml = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <info>
      <contact:info xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8018</contact:id>
      </contact:info>
    </info>
  </command>
</epp>`;
  const info = await contactHandler.handle(parseEppXml(infoXml), context());
  assert.match(info, /<contact:voice x="3468">\+1\.2742995934<\/contact:voice>/);
  assert.match(info, /<contact:fax x="0335">\+1\.9834563624<\/contact:fax>/);
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

test("contact check rejects schema-invalid (overlong) contact ids with 2005", async () => {
  const overlong = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <contact:check xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>toolongcontactid1</contact:id>
      </contact:check>
    </check>
  </command>
</epp>`;
  const response = await handler().handle(parseEppXml(overlong), context());
  assert.match(response, /<result code="2005">/);
});

test("contact create rejects postal lines longer than 255 and email local longer than 64", async () => {
  const longName = "N".repeat(256);
  const longNameXml = createXml.replace("John Doe", longName).replace("sh8013", "len255a");
  const name = await handler().handle(parseEppXml(longNameXml), context());
  assert.match(name, /<result code="2005">/);
  assert.match(name, /maximum length of 255/);

  const longLocal = `${"a".repeat(65)}@example.net`;
  const emailXml = createXml.replace("jdoe@example.melendez", longLocal).replace("sh8013", "len255b");
  const email = await handler().handle(parseEppXml(emailXml), context());
  assert.match(email, /<result code="2005">/);
  assert.match(email, /Contact email is invalid/);
});

test("contact update rejects non-client statuses and duplicate add/rem", async () => {
  const contactHandler = handler();
  await contactHandler.handle(parseEppXml(createXml), context());

  const serverStatus = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <contact:update xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
        <contact:add><contact:status s="serverDeleteProhibited"/></contact:add>
      </contact:update>
    </update>
  </command>
</epp>`;
  const rejected = await contactHandler.handle(parseEppXml(serverStatus), context());
  assert.match(rejected, /<result code="2005">/);
  assert.match(rejected, /not client-settable/);

  const duplicate = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <contact:update xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
        <contact:add><contact:status s="clientUpdateProhibited"/></contact:add>
        <contact:rem><contact:status s="clientUpdateProhibited"/></contact:rem>
      </contact:update>
    </update>
  </command>
</epp>`;
  const dup = await contactHandler.handle(parseEppXml(duplicate), context());
  assert.match(dup, /<result code="2005">/);
  assert.match(dup, /both add and rem/);

  const okStatus = `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <update>
      <contact:update xmlns:contact="urn:ietf:params:xml:ns:contact-1.0">
        <contact:id>sh8013</contact:id>
        <contact:add><contact:status s="clientTransferProhibited"/></contact:add>
      </contact:update>
    </update>
  </command>
</epp>`;
  const ok = await contactHandler.handle(parseEppXml(okStatus), context());
  assert.match(ok, /<result code="1000">/);
});
