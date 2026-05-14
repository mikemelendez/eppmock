import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createPublicKey, generateKeyPairSync } from "node:crypto";

export interface DnssecKeyPair {
  role: "KSK" | "ZSK";
  privateKeyPem: string;
  publicKeyPem: string;
  createdAt: string;
}

export interface DnssecKeySet {
  ksk: DnssecKeyPair;
  zsk: DnssecKeyPair;
  updatedAt: string;
}

export class DnssecKeyStore {
  constructor(private readonly keyPath: string) {}

  loadOrCreate(action: "generate" | "renew"): DnssecKeySet {
    const existing = this.read();

    if (existing && action === "generate") {
      return existing;
    }

    const keySet: DnssecKeySet = {
      ksk: action === "renew" ? createKeyPair("KSK") : existing?.ksk ?? createKeyPair("KSK"),
      zsk: createKeyPair("ZSK"),
      updatedAt: new Date().toISOString()
    };

    this.write(keySet);
    return keySet;
  }

  private read(): DnssecKeySet | null {
    const absolutePath = resolve(this.keyPath);

    if (!existsSync(absolutePath)) {
      return null;
    }

    const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as DnssecKeySet;
    return parsed;
  }

  private write(keySet: DnssecKeySet): void {
    const absolutePath = resolve(this.keyPath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify(keySet, null, 2)}\n`, { mode: 0o600 });
  }
}

export function dnssecPublicKey(publicKeyPem: string): string {
  const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" });

  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new Error("DNSSEC ECDSA public key is missing P-256 coordinates");
  }

  return Buffer.concat([base64UrlToBuffer(jwk.x), base64UrlToBuffer(jwk.y)]).toString("base64");
}

function createKeyPair(role: "KSK" | "ZSK"): DnssecKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem"
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem"
    }
  });

  return {
    role,
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    createdAt: new Date().toISOString()
  };
}

function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}
