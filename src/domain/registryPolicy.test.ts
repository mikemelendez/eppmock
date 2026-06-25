import test from "node:test";
import assert from "node:assert/strict";
import { RegistryPolicy, RegistryPolicyError } from "./registryPolicy.js";

test("normalizes second-level .melendez names and IDNs", () => {
  const policy = new RegistryPolicy("melendez");

  assert.equal(policy.normalizeDomainName("Example.Melendez.").canonicalName, "example.melendez");
  const idn = policy.normalizeDomainName("café.melendez");
  assert.equal(idn.canonicalName, "xn--caf-dma.melendez");
  assert.equal(idn.unicodeName, "café.melendez");
  assert.equal(policy.normalizeDomainName("xn--caf-dma.melendez").unicodeName, "café.melendez");
});

test("rejects names outside registry policy", () => {
  const policy = new RegistryPolicy("melendez");
  const invalidNames = [
    "example.com",
    "melendez",
    ".melendez",
    "foo.bar.melendez",
    "-bad.melendez",
    "bad-.melendez",
    "nic.melendez",
    "whois.melendez",
    "www.melendez",
    "ab.melendez",
    "nike.melendez",
    "mexico.melendez",
    "usa.melendez"
  ];

  for (const name of invalidNames) {
    assert.throws(() => policy.normalizeDomainName(name), RegistryPolicyError);
  }
});
