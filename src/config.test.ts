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
});
