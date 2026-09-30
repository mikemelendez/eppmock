import test from "node:test";
import assert from "node:assert/strict";
import { allowedClientCertFingerprints, clientCertificateAllowed } from "./eppServer.js";

test("clientCertificateAllowed rejects unknown and missing certs when allowlisted", () => {
  const allowed = new Set(["aa".repeat(32), "bb".repeat(32)]);

  assert.equal(clientCertificateAllowed("aa".repeat(32), allowed, true), true);
  assert.equal(clientCertificateAllowed("bb".repeat(32).toUpperCase(), allowed, true), true);
  assert.equal(clientCertificateAllowed("cc".repeat(32), allowed, true), false);
  assert.equal(clientCertificateAllowed(undefined, allowed, true), false);
  assert.equal(clientCertificateAllowed(undefined, allowed, false), false);
});

test("clientCertificateAllowed is open when no fingerprints are configured", () => {
  const empty = new Set<string>();
  assert.equal(clientCertificateAllowed(undefined, empty, false), true);
  assert.equal(clientCertificateAllowed("aa".repeat(32), empty, false), true);
  assert.equal(clientCertificateAllowed(undefined, empty, true), false);
  assert.equal(clientCertificateAllowed("aa".repeat(32), empty, true), true);
});

test("allowedClientCertFingerprints collects unique normalized hashes", () => {
  const fingerprints = allowedClientCertFingerprints({
    authUsers: [
      { clid: "a", password: "x", clientCertSha256: "AA:BB:CC:DD" },
      { clid: "b", password: "y", clientCertSha256: "aabbccdd" },
      { clid: "c", password: "z" }
    ]
  });

  assert.deepEqual([...fingerprints], ["aabbccdd"]);
});
