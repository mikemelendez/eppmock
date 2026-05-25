import test from "node:test";
import assert from "node:assert/strict";
import { extractCommand } from "./commandExtractor.js";
import { parseEppXml } from "./xml.js";

test("extracts prefixed domain commands", () => {
  const command = extractCommand(
    parseEppXml(`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <domain:check xmlns:domain="urn:ietf:params:xml:ns:domain-1.0">
        <domain:name>example.melendez</domain:name>
      </domain:check>
    </check>
    <clTRID>prefixed-check</clTRID>
  </command>
</epp>`)
  );

  assert.deepEqual(command, {
    name: "domain:check",
    transactionId: "prefixed-check"
  });
});

test("extracts default/local domain commands instead of unknown", () => {
  const command = extractCommand(
    parseEppXml(`<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <check>
      <check xmlns="urn:ietf:params:xml:ns:domain-1.0">
        <name>example.melendez</name>
      </check>
    </check>
    <clTRID>local-check</clTRID>
  </command>
</epp>`)
  );

  assert.deepEqual(command, {
    name: "domain:check",
    transactionId: "local-check"
  });
});

test("extracts hello at root or inside command", () => {
  assert.equal(
    extractCommand(parseEppXml(`<epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><hello /></epp>`)).name,
    "hello"
  );
  assert.deepEqual(
    extractCommand(
      parseEppXml(`<epp xmlns="urn:ietf:params:xml:ns:epp-1.0"><command><hello /><clTRID>hello-command</clTRID></command></epp>`)
    ),
    {
      name: "hello",
      transactionId: "hello-command"
    }
  );
});
