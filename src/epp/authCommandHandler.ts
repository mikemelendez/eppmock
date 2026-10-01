import type { AppConfig } from "../config.js";
import { childValue, getCommand, node, stringValues, text } from "./commandExtractor.js";
import { supportedObjectUris } from "./responses.js";
import {
  authenticationError,
  commandCompleted,
  sessionEnded,
  syntaxError,
  unimplementedObjectService,
  unimplementedOption,
  unimplementedProtocolVersion
} from "./responses.js";
import type { CommandContext, CommandHandler } from "./types.js";

type CertDecision =
  | { accept: true }
  | { accept: false; reason: string; detail?: string };

export class AuthCommandHandler implements CommandHandler {
  constructor(private readonly config: Pick<AppConfig, "authUsers" | "eppTlsRequireClientCert">) {}

  async handle(document: Record<string, unknown>, context: CommandContext): Promise<string> {
    const command = getCommand(document);

    if (!command) {
      return syntaxError(context.transactionId);
    }

    if ("login" in command) {
      return this.login(command.login, context);
    }

    if ("logout" in command) {
      context.session.authenticated = false;
      return sessionEnded(context.transactionId);
    }

    return syntaxError(context.transactionId);
  }

  private login(value: unknown, context: CommandContext): string {
    const login = node(value);
    const clid = text(login?.clID);
    const password = text(login?.pw);

    const options = node(login?.options);
    const version = text(options?.version);
    const lang = text(options?.lang);

    // The XML parser may coerce "1.0" to the number 1, so accept both forms.
    if (version !== undefined && version !== "1.0" && version !== "1") {
      return unimplementedProtocolVersion(context.transactionId);
    }

    if (lang !== undefined && lang !== "en") {
      return unimplementedOption(context.transactionId);
    }

    const requestedObjects = stringValues(childValue(node(login?.svcs), "objURI"));
    const unsupportedObject = requestedObjects.find((uri) => !supportedObjectUris.includes(uri));

    if (unsupportedObject) {
      return unimplementedObjectService(context.transactionId);
    }

    const user = this.config.authUsers.find((authUser) => authUser.clid === clid);

    if (!user || password !== user.password) {
      console.log(
        `EPP login rejected session=${context.session.id} clid=${clid ?? "(none)"}` +
          ` reason=${user ? "bad-password" : "unknown-clid"} tls=${context.session.tls}`
      );
      return authenticationError(context.transactionId);
    }

    const certDecision = this.clientCertificateDecision(user, context);
    if (!certDecision.accept) {
      console.log(
        `EPP login rejected session=${context.session.id} clid=${clid}` +
          ` reason=${certDecision.reason}` +
          (certDecision.detail ? ` ${certDecision.detail}` : "") +
          ` tls=${context.session.tls}` +
          ` presented=${normalizeFingerprint(context.session.clientCertSha256) ?? "(none)"}` +
          ` expected=${normalizeFingerprint(user.clientCertSha256) ?? "(none)"}`
      );
      return authenticationError(context.transactionId);
    }

    context.session.authenticated = true;
    context.session.clid = clid;
    console.log(
      `EPP login ok session=${context.session.id} clid=${clid} tls=${context.session.tls}` +
        ` cert=${normalizeFingerprint(context.session.clientCertSha256) ?? "(none)"}`
    );
    return commandCompleted(context.transactionId);
  }

  private clientCertificateDecision(
    user: { clid: string; clientCertSha256?: string },
    context: CommandContext
  ): CertDecision {
    // Plaintext (dashboard) sessions skip cert binding. TLS sessions follow epp-03.
    if (!context.session.tls) {
      return { accept: true };
    }

    const requireCert = this.config.eppTlsRequireClientCert;
    const anyMappedCert = this.config.authUsers.some((authUser) => authUser.clientCertSha256);

    if (!requireCert && !anyMappedCert) {
      return { accept: true };
    }

    const presented = normalizeFingerprint(context.session.clientCertSha256);

    if (!presented) {
      return {
        accept: false,
        reason: "missing-client-cert",
        detail: "TLS login requires a client certificate"
      };
    }

    const owner = this.config.authUsers.find(
      (authUser) => normalizeFingerprint(authUser.clientCertSha256) === presented
    );

    if (owner && owner.clid !== user.clid) {
      return {
        accept: false,
        reason: "client-cert-bound-to-other-clid",
        detail: `cert belongs to ${owner.clid}`
      };
    }

    const expected = normalizeFingerprint(user.clientCertSha256);

    if (expected && expected !== presented) {
      return {
        accept: false,
        reason: "client-cert-mismatch",
        detail: "presented fingerprint does not match this clid"
      };
    }

    // requireCert with no fingerprint on this user and an unmapped cert: reject.
    // RST epp-03 step 6 needs clientCertSha256 on epp.clid01 (often melendez-admin).
    if (requireCert && !expected && !owner) {
      return {
        accept: false,
        reason: "clid-missing-clientCertSha256",
        detail: "set clientCertSha256 on this EPP_USERS entry to the RST client01 fingerprint"
      };
    }

    return { accept: true };
  }
}

function normalizeFingerprint(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.replaceAll(":", "").replaceAll(" ", "").toLowerCase();
}
