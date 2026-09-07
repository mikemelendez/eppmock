import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "./config.js";

test("requires explicit secrets for production", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        RESET_HTTP_PASSWORD: "reset-secret"
      } as NodeJS.ProcessEnv),
    /RESET_HTTP_PASSWORD/
  );

  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        RESET_HTTP_PASSWORD: "strong-reset-password"
      } as NodeJS.ProcessEnv),
    /EPP_USERS/
  );
});

test("loads registry, WHOIS, and DNSSEC settings from the environment", () => {
  const config = loadConfig({
    DNSSEC_KEY_PATH: "data/custom-dnssec-keys.json",
    REGISTRY_TLD: "melendez",
    WHOIS_HOST: "0.0.0.0",
    WHOIS_PORT: "8043"
  } as NodeJS.ProcessEnv);

  assert.equal(config.dnssecKeyPath, "data/custom-dnssec-keys.json");
  assert.equal(config.registryTld, "melendez");
  assert.equal(config.whoisHost, "0.0.0.0");
  assert.equal(config.whoisPort, 8043);
  assert.equal(config.repositoryId, "ICANNRST");
  assert.equal(config.eppTlsRequireClientCert, false);
});

test("loads dashboard plaintext listener settings", () => {
  const config = loadConfig({
    EPP_PORT: "700",
    EPP_DASHBOARD_HOST: "127.0.0.1",
    EPP_DASHBOARD_PORT: "7000"
  } as NodeJS.ProcessEnv);

  assert.equal(config.eppPort, 700);
  assert.equal(config.eppDashboardHost, "127.0.0.1");
  assert.equal(config.eppDashboardPort, 7000);
});

test("TLS client-certificate requirement is a real boolean and not coerced from the string false", () => {
  const config = loadConfig({
    EPP_TLS_CERT: "/tmp/cert.pem",
    EPP_TLS_KEY: "/tmp/key.pem",
    EPP_TLS_REQUIRE_CLIENT_CERT: "false",
    EPP_REPOSITORY_ID: "MELENDEZ"
  } as NodeJS.ProcessEnv);

  assert.equal(config.eppTlsRequireClientCert, false);
  assert.equal(config.repositoryId, "MELENDEZ");
  assert.equal(config.eppTlsCertPath, "/tmp/cert.pem");
});
