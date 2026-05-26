import net from "node:net";
import type { AppConfig } from "../config.js";
import { EppFrameDecoder, encodeFrame } from "./framing.js";

export interface EppClientRequest {
  xml: string;
  autoLogin: boolean;
  clid?: string;
  password?: string;
  timeoutMs?: number;
}

export interface EppClientFrame {
  type: "greeting" | "login" | "command";
  xml: string;
}

export interface EppClientResult {
  frames: EppClientFrame[];
}

export async function sendEppRequest(
  config: Pick<AppConfig, "eppHost" | "eppPort" | "authUsers">,
  request: EppClientRequest
): Promise<EppClientResult> {
  const timeoutMs = request.timeoutMs ?? 5_000;
  const helloRequest = isHelloRequest(request.xml);
  const autoLogin = request.autoLogin && !helloRequest;
  const expectedFrames = helloRequest ? 1 : autoLogin ? 3 : 2;
  const decoder = new EppFrameDecoder();
  const frames: EppClientFrame[] = [];
  const fallbackUser = config.authUsers[0];
  const loginClid = request.clid ?? fallbackUser.clid;
  const loginPassword = request.password ?? fallbackUser.password;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: config.eppHost,
      port: config.eppPort
    });

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`EPP request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.removeAllListeners();
    };

    socket.on("data", (chunk) => {
      const messages = decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

      for (const xml of messages) {
        const type = frameType(frames.length, autoLogin);
        frames.push({ type, xml });
      }

      if (!helloRequest && frames.length === 1) {
        if (autoLogin) {
          socket.write(encodeFrame(loginXml(loginClid, loginPassword)));
        } else {
          socket.write(encodeFrame(request.xml));
        }
      } else if (autoLogin && frames.length === 2) {
        socket.write(encodeFrame(request.xml));
      }

      if (frames.length >= expectedFrames) {
        cleanup();
        socket.end();
        resolve({ frames });
      }
    });

    socket.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}

function frameType(index: number, autoLogin: boolean): EppClientFrame["type"] {
  if (index === 0) {
    return "greeting";
  }

  if (autoLogin && index === 1) {
    return "login";
  }

  return "command";
}

function isHelloRequest(xml: string): boolean {
  return /<\s*(?:[A-Za-z_][\w.-]*:)?hello(?:\s|\/|>)/u.test(xml);
}

function loginXml(clid: string, password: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<epp xmlns="urn:ietf:params:xml:ns:epp-1.0">
  <command>
    <login>
      <clID>${escapeXml(clid)}</clID>
      <pw>${escapeXml(password)}</pw>
      <options>
        <version>1.0</version>
        <lang>en</lang>
      </options>
      <svcs>
        <objURI>urn:ietf:params:xml:ns:domain-1.0</objURI>
      </svcs>
    </login>
    <clTRID>dashboard-login</clTRID>
  </command>
</epp>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
