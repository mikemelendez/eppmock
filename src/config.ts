import { z } from "zod";

const authUserSchema = z.object({
  clid: z.string().min(1),
  password: z.string().min(1),
  clientCertSha256: z.string().min(8).optional()
});

export type AuthUser = z.infer<typeof authUserSchema>;

export const defaultAuthUsers: AuthUser[] = [
  { clid: "melendez-admin", password: "admin-secret" },
  { clid: "melendez-registrar", password: "registrar-secret" },
  { clid: "melendez-tester", password: "tester-secret" }
];

const configSchema = z.object({
  eppHost: z.string().default("127.0.0.1"),
  eppPort: z.coerce.number().int().positive().default(7000),
  eppDashboardHost: z.string().optional(),
  eppDashboardPort: z.coerce.number().int().positive().optional(),
  whoisHost: z.string().default("127.0.0.1"),
  whoisPort: z.coerce.number().int().positive().default(43),
  controlHost: z.string().default("127.0.0.1"),
  controlPort: z.coerce.number().int().positive().default(8080),
  rdapHost: z.string().default("127.0.0.1"),
  rdapPort: z.coerce.number().int().positive().default(8090),
  greetingServerId: z.string().default("epp-testing-tool"),
  registryTld: z.string().default("melendez"),
  authUsers: z.array(authUserSchema).min(1).default(defaultAuthUsers),
  resetHttpUser: z.string().default("admin"),
  resetHttpPassword: z.string().default("reset-secret"),
  storageMode: z.enum(["memory", "sqlite"]).default("sqlite"),
  sqlitePath: z.string().default("data/epp-testing-tool.sqlite"),
  dnssecKeyPath: z.string().default("data/dnssec-keys.json"),
  repositoryId: z.string().regex(/^\w{1,8}$/).default("ICANNRST"),
  eppTlsCertPath: z.string().optional(),
  eppTlsKeyPath: z.string().optional(),
  eppTlsCaPath: z.string().optional(),
  eppTlsRequireClientCert: z.boolean().default(false)
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  const config = configSchema.parse({
    eppHost: env.EPP_HOST,
    eppPort: env.EPP_PORT,
    eppDashboardHost: env.EPP_DASHBOARD_HOST,
    eppDashboardPort: env.EPP_DASHBOARD_PORT,
    whoisHost: env.WHOIS_HOST,
    whoisPort: env.WHOIS_PORT,
    controlHost: env.CONTROL_HOST,
    controlPort: env.CONTROL_PORT,
    rdapHost: env.RDAP_HOST,
    rdapPort: env.RDAP_PORT,
    greetingServerId: env.GREETING_SERVER_ID,
    registryTld: env.REGISTRY_TLD,
    authUsers: loadAuthUsers(env),
    resetHttpUser: env.RESET_HTTP_USER,
    resetHttpPassword: env.RESET_HTTP_PASSWORD,
    storageMode: env.STORAGE_MODE,
    sqlitePath: env.SQLITE_PATH,
    dnssecKeyPath: env.DNSSEC_KEY_PATH,
    repositoryId: env.EPP_REPOSITORY_ID,
    eppTlsCertPath: env.EPP_TLS_CERT,
    eppTlsKeyPath: env.EPP_TLS_KEY,
    eppTlsCaPath: env.EPP_TLS_CA,
    eppTlsRequireClientCert: parseBool(
      env.EPP_TLS_REQUIRE_CLIENT_CERT,
      Boolean(env.EPP_TLS_CERT && env.EPP_TLS_KEY)
    )
  });

  validateProductionConfig(config, env);
  return config;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  return fallback;
}

function loadAuthUsers(env: NodeJS.ProcessEnv): AuthUser[] {
  if (env.EPP_USERS) {
    return z.array(authUserSchema).min(1).parse(JSON.parse(env.EPP_USERS));
  }

  if (env.EPP_CLID || env.EPP_PASSWORD) {
    return [
      {
        clid: env.EPP_CLID ?? defaultAuthUsers[0].clid,
        password: env.EPP_PASSWORD ?? defaultAuthUsers[0].password
      },
      ...defaultAuthUsers.slice(1)
    ];
  }

  return defaultAuthUsers;
}

export function isTlsEnabled(config: AppConfig): boolean {
  return Boolean(config.eppTlsCertPath && config.eppTlsKeyPath);
}

function validateProductionConfig(config: AppConfig, env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== "production") {
    return;
  }

  if (config.resetHttpPassword === "reset-secret" || config.resetHttpPassword === "change-me") {
    throw new Error("RESET_HTTP_PASSWORD must be changed before running in production");
  }

  if (!env.EPP_USERS) {
    throw new Error("EPP_USERS must be set before running in production");
  }
}
