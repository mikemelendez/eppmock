import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const script = join(dirname(fileURLToPath(import.meta.url)), "../../deploy/export-caddy-certs.mjs");

test("export-caddy-certs copies the matching Caddy host certificate", () => {
  const root = mkdtempSync(join(tmpdir(), "caddy-certs-"));

  try {
    const issuer = join(root, "caddy", "certificates", "acme-v02.api.letsencrypt.org-directory", "eppmock.melendez.mx");
    mkdirSync(issuer, { recursive: true });
    writeFileSync(join(issuer, "eppmock.melendez.mx.crt"), "CERT");
    writeFileSync(join(issuer, "eppmock.melendez.mx.key"), "KEY");

    const dest = join(root, "out");
    execFileSync(process.execPath, [script], {
      env: {
        ...process.env,
        EPP_HOSTNAME: "eppmock.melendez.mx",
        CADDY_CERTS_ROOT: join(root, "caddy", "certificates"),
        EPP_CERT_DIR: dest
      }
    });

    assert.equal(readFileSync(join(dest, "fullchain.pem"), "utf8"), "CERT");
    assert.equal(readFileSync(join(dest, "privkey.pem"), "utf8"), "KEY");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export-caddy-certs exits when the host certificate is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "caddy-certs-missing-"));

  try {
    mkdirSync(join(root, "caddy", "certificates"), { recursive: true });

    assert.throws(
      () =>
        execFileSync(process.execPath, [script], {
          env: {
            ...process.env,
            EPP_HOSTNAME: "eppmock.melendez.mx",
            CADDY_CERTS_ROOT: join(root, "caddy", "certificates"),
            EPP_CERT_DIR: join(root, "out")
          }
        }),
      /Command failed/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
