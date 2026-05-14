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

test("loads DNSSEC key path from the environment", () => {
  const config = loadConfig({
    DNSSEC_KEY_PATH: "data/custom-dnssec-keys.json"
  } as NodeJS.ProcessEnv);

  assert.equal(config.dnssecKeyPath, "data/custom-dnssec-keys.json");
});
