import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { CommandLogRepository } from "./commandLogRepository.js";
import { CommandRouter } from "./commandRouter.js";
import { AuthCommandHandler } from "./authCommandHandler.js";
import { startEppServer } from "./eppServer.js";
import { EppFrameDecoder, encodeFrame } from "./framing.js";

function fingerprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256.replaceAll(":", "").toLowerCase();
}

test("epp-01/03 TLS 1.2 greeting and client-certificate login binding", async (t) => {
  let opensslOk = true;
  try {
    execFileSync("openssl", ["version"]);
  } catch {
    opensslOk = false;
  }

  if (!opensslOk) {
    t.skip("openssl is required for TLS fixture generation");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "epp-tls-"));

  try {
    const caKey = join(dir, "ca.key");
    const caCert = join(dir, "ca.pem");
    const serverKey = join(dir, "server.key");
    const serverCert = join(dir, "server.pem");
    const client1Key = join(dir, "client1.key");
    const client1Cert = join(dir, "client1.pem");
    const client2Key = join(dir, "client2.key");
    const client2Cert = join(dir, "client2.pem");

    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", caCert, "-days", "1", "-subj", "/CN=EPP Test CA"]);
    execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", serverKey, "-out", join(dir, "server.csr"), "-subj", "/CN=localhost"]);
    execFileSync("openssl", ["x509", "-req", "-in", join(dir, "server.csr"), "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-out", serverCert, "-days", "1"]);
    execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", client1Key, "-out", join(dir, "c1.csr"), "-subj", "/CN=melendez-registrar"]);
    execFileSync("openssl", ["x509", "-req", "-in", join(dir, "c1.csr"), "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-out", client1Cert, "-days", "1"]);
    execFileSync("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", client2Key, "-out", join(dir, "c2.csr"), "-subj", "/CN=melendez-tester"]);
    execFileSync("openssl", ["x509", "-req", "-in", join(dir, "c2.csr"), "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-out", client2Cert, "-days", "1"]);

    const fp1 = fingerprint(readFileSync(client1Cert, "utf8"));
    const fp2 = fingerprint(readFileSync(client2Cert, "utf8"));

    const config = loadConfig({
      EPP_HOST: "127.0.0.1",
      EPP_TLS_CERT: serverCert,
      EPP_TLS_KEY: serverKey,
      EPP_TLS_CA: caCert,
      EPP_TLS_REQUIRE_CLIENT_CERT: "true",
      EPP_USERS: JSON.stringify([
        { clid: "melendez-registrar", password: "registrar-secret", clientCertSha256: fp1 },
        { clid: "melendez-tester", password: "tester-secret", clientCertSha256: fp2 }
      ]),
      STORAGE_MODE: "memory"
    } as NodeJS.ProcessEnv);

    const router = new CommandRouter(new AuthCommandHandler(config), new CommandLogRepository());
    const server = startEppServer(config, router, { port: 0, host: "127.0.0.1", label: "tls-test", exitOnError: false });
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const port = address.port;

    const greeting = await tlsExchange(port, { ca: readFileSync(caCert), key: readFileSync(client1Key), cert: readFileSync(client1Cert) });
    assert.match(greeting.frames[0] ?? "", /<greeting>/);
    assert.match(greeting.frames[0] ?? "", /<version>1\.0<\/version>/);

    const loginOk = await tlsExchange(
      port,
      { ca: readFileSync(caCert), key: readFileSync(client1Key), cert: readFileSync(client1Cert) },
      loginXml("melendez-registrar", "registrar-secret")
    );
    assert.match(loginOk.frames[1] ?? "", /<result code="1000">/);

    const wrongCert = await tlsExchange(
      port,
      { ca: readFileSync(caCert), key: readFileSync(client2Key), cert: readFileSync(client2Cert) },
      loginXml("melendez-registrar", "registrar-secret")
    );
    assert.match(wrongCert.frames[1] ?? "", /<result code="2200">/);

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function loginXml(clid: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>${clid}</clID>
      <pw>${password}</pw>
      <options><version>1.0</version><lang>en</lang></options>
      <svcs><objURI>urn:ietf:params:xml:ns:domain-1.0</objURI></svcs>
    </login>
  </command>
</epp>`;
}

function tlsExchange(
  port: number,
  tlsOptions: tls.ConnectionOptions,
  commandXml?: string
): Promise<{ frames: string[] }> {
  return new Promise((resolve, reject) => {
    const decoder = new EppFrameDecoder();
    const frames: string[] = [];
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
      ...tlsOptions
    });

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("TLS EPP exchange timed out"));
    }, 5000);

    socket.on("secureConnect", () => {
      /* greeting is sent by the server after the handshake */
    });

    socket.on("data", (chunk) => {
      frames.push(...decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      if (commandXml && frames.length === 1) {
        socket.write(encodeFrame(commandXml));
      }
      if (frames.length >= (commandXml ? 2 : 1)) {
        clearTimeout(timeout);
        socket.end();
        resolve({ frames });
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}
