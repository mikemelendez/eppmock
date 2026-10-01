import { createHash, X509Certificate } from "node:crypto";
import { Duplex, type DuplexOptions } from "node:stream";
import type net from "node:net";

/**
 * TEMPORARY DEBUG: inspect cleartext TLS handshake Certificate messages (TLS 1.2)
 * in wire order so we can deny RST epp-01 extraneous / unordered presentations
 * before the handshake completes. OpenSSL/Node otherwise normalize those chains
 * and make them indistinguishable after secureConnection.
 */

const TLS_HANDSHAKE = 0x16;
const HS_CERTIFICATE = 0x0b;

export type WireCertGuardDecision =
  | { action: "continue" }
  | { action: "reject"; reason: string; detail: string };

export interface WireCertGuardOptions {
  /** Allowed leaf SHA-256 hex fingerprints (no colons). */
  allowedLeafSha256: Set<string>;
  /** Known intermediate/root fingerprints for the normal RST chain (no colons). */
  knownChainSha256?: Set<string>;
  label?: string;
}

/**
 * Duplex placed between a raw TCP socket and tls.TLSSocket.
 * Forwards bytes unchanged unless a cleartext client Certificate message is
 * classified as an RST extraneous/unordered variation — then destroys the TCP socket.
 */
export class TlsWireCertGuard extends Duplex {
  private readonly raw: net.Socket;
  private readonly allowedLeafSha256: Set<string>;
  private readonly knownChainSha256: Set<string>;
  private readonly label: string;
  private clientBuffer = Buffer.alloc(0);
  private handshakeBuffer = Buffer.alloc(0);
  private rejected = false;
  private sawCleartextCertificate = false;

  constructor(raw: net.Socket, options: WireCertGuardOptions, duplexOptions?: DuplexOptions) {
    super(duplexOptions);
    this.raw = raw;
    this.allowedLeafSha256 = options.allowedLeafSha256;
    this.knownChainSha256 = options.knownChainSha256 ?? new Set();
    this.label = options.label ?? "EPP testing tool";

    raw.on("data", (chunk: Buffer) => {
      if (this.rejected) {
        return;
      }
      this.clientBuffer = Buffer.concat([this.clientBuffer, chunk]);
      const decision = this.consumeClientBuffer();
      if (decision.action === "reject") {
        this.rejected = true;
        console.log(
          `${this.label} TEMPORARY DEBUG denying TLS handshake` +
            ` remote=${formatRemote(raw)} reason=${decision.reason} ${decision.detail}`
        );
        raw.destroy();
        this.destroy();
        return;
      }
      // Forward only newly received chunk to TLS layer (buffer kept for re-parse).
      this.push(chunk);
    });

    raw.on("end", () => this.push(null));
    raw.on("error", (error) => this.destroy(error));
    raw.on("close", () => {
      if (!this.destroyed) {
        this.push(null);
      }
    });
  }

  /** Expose peer addressing so tls.TLSSocket logging still works through this Duplex. */
  get remoteAddress(): string | undefined {
    return this.raw.remoteAddress;
  }

  get remotePort(): number | undefined {
    return this.raw.remotePort;
  }

  get remoteFamily(): string | undefined {
    return this.raw.remoteFamily;
  }

  override _read(): void {
    // Push is driven by raw 'data' events.
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.rejected) {
      callback();
      return;
    }
    this.raw.write(chunk, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.raw.end();
    callback();
  }

  get sawCleartextClientCertificate(): boolean {
    return this.sawCleartextCertificate;
  }

  private consumeClientBuffer(): WireCertGuardDecision {
    let offset = 0;

    while (offset + 5 <= this.clientBuffer.length) {
      const type = this.clientBuffer[offset];
      const length = this.clientBuffer.readUInt16BE(offset + 3);
      const recordEnd = offset + 5 + length;
      if (recordEnd > this.clientBuffer.length) {
        break;
      }

      if (type === TLS_HANDSHAKE) {
        const fragment = this.clientBuffer.subarray(offset + 5, recordEnd);
        this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, fragment]);
        const decision = this.consumeHandshakeBuffer();
        if (decision.action === "reject") {
          return decision;
        }
      }

      offset = recordEnd;
    }

    if (offset > 0) {
      this.clientBuffer = this.clientBuffer.subarray(offset);
    }

    return { action: "continue" };
  }

  private consumeHandshakeBuffer(): WireCertGuardDecision {
    let offset = 0;

    while (offset + 4 <= this.handshakeBuffer.length) {
      const hsType = this.handshakeBuffer[offset];
      const hsLength = this.handshakeBuffer.readUIntBE(offset + 1, 3);
      const hsEnd = offset + 4 + hsLength;
      if (hsEnd > this.handshakeBuffer.length) {
        break;
      }

      if (hsType === HS_CERTIFICATE) {
        this.sawCleartextCertificate = true;
        const body = this.handshakeBuffer.subarray(offset + 4, hsEnd);
        const decision = classifyCertificateBody(body, this.allowedLeafSha256, this.knownChainSha256);
        if (decision.action === "reject") {
          return decision;
        }
      }

      offset = hsEnd;
    }

    if (offset > 0) {
      this.handshakeBuffer = this.handshakeBuffer.subarray(offset);
    }

    return { action: "continue" };
  }
}

function formatRemote(socket: net.Socket): string {
  return `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? "?"}`;
}

function classifyCertificateBody(
  body: Buffer,
  allowedLeafSha256: Set<string>,
  knownChainSha256: Set<string>
): WireCertGuardDecision {
  // Prefer TLS 1.2 layout (no request context).
  const tls12 = parseCertList(body, 0);
  if (tls12) {
    return classifyCerts(tls12, allowedLeafSha256, knownChainSha256);
  }

  // TLS 1.3 Certificate (cleartext only in abnormal cases): context + list.
  if (body.length >= 1) {
    const ctxLen = body[0];
    const tls13 = parseCertList(body, 1 + ctxLen);
    if (tls13) {
      return classifyCerts(tls13, allowedLeafSha256, knownChainSha256);
    }
  }

  return { action: "continue" };
}

function parseCertList(body: Buffer, listOffset: number): X509Certificate[] | undefined {
  if (listOffset + 3 > body.length) {
    return undefined;
  }
  const listLength = body.readUIntBE(listOffset, 3);
  const listEnd = listOffset + 3 + listLength;
  if (listEnd > body.length) {
    return undefined;
  }

  const certs: X509Certificate[] = [];
  let offset = listOffset + 3;

  while (offset < listEnd) {
    if (offset + 3 > listEnd) {
      return undefined;
    }
    const certLen = body.readUIntBE(offset, 3);
    offset += 3;
    if (certLen < 1 || offset + certLen > listEnd) {
      return undefined;
    }
    const der = body.subarray(offset, offset + certLen);
    offset += certLen;
    try {
      certs.push(new X509Certificate(der));
    } catch {
      return undefined;
    }
  }

  // TLS 1.2 Certificate body is exactly the list; trailing bytes ⇒ not this layout.
  if (listEnd !== body.length) {
    return undefined;
  }

  return certs;
}

function classifyCerts(
  certs: X509Certificate[],
  allowedLeafSha256: Set<string>,
  knownChainSha256: Set<string>
): WireCertGuardDecision {
  if (certs.length === 0) {
    return { action: "continue" };
  }

  const fingerprints = certs.map(sha256Fingerprint);
  const leafIndexes = fingerprints
    .map((fp, index) => (allowedLeafSha256.has(fp) ? index : -1))
    .filter((index) => index >= 0);

  if (leafIndexes.length === 0) {
    // e.g. Internet Widgits / unknown leaf alone or with junk
    return {
      action: "reject",
      reason: "extraneous-or-unknown-leaf",
      detail: `wireCerts=${certs.length} first=${subjectCn(certs[0])} sha256=${fingerprints[0]}`
    };
  }

  if (leafIndexes[0] !== 0) {
    return {
      action: "reject",
      reason: "disordered-certificate-chain",
      detail: `allowed leaf at wire index ${leafIndexes[0]} (not first); wireOrder=${certs.map(subjectCn).join(">")}`
    };
  }

  // Leaf is first. Any adjacent issuer/subject break ⇒ RST epp-01 variation
  // (extraneous cert inserted, or intermediates in arbitrary order).
  let hasLinkBreak = false;
  for (let i = 0; i < certs.length - 1; i += 1) {
    if (!dnEquals(certs[i].issuer, certs[i + 1].subject)) {
      hasLinkBreak = true;
      break;
    }
  }

  if (!hasLinkBreak) {
    return { action: "continue" };
  }

  const known = new Set([...allowedLeafSha256, ...knownChainSha256]);
  const unknownPresent = fingerprints.some((fp) => !known.has(fp));
  if (unknownPresent) {
    return {
      action: "reject",
      reason: "extraneous-certificate",
      detail: `wireOrder=${certs.map(subjectCn).join(">")}`
    };
  }

  return {
    action: "reject",
    reason: "disordered-certificate-chain",
    detail: `wireOrder=${certs.map(subjectCn).join(">")}`
  };
}

function sha256Fingerprint(cert: X509Certificate): string {
  return createHash("sha256").update(cert.raw).digest("hex");
}

function subjectCn(cert: X509Certificate): string {
  const match = /CN=([^\n]+)/.exec(cert.subject);
  return match?.[1] ?? cert.subject.replaceAll("\n", ",");
}

function dnEquals(a: string, b: string): boolean {
  return normalizeDn(a) === normalizeDn(b);
}

function normalizeDn(value: string): string {
  return value
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join("\n")
    .toLowerCase();
}
