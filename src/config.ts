import { z } from "zod";

const authUserSchema = z.object({
  clid: z.string().min(1),
  password: z.string().min(1)
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
  eppMockHost: z.string().default("127.0.0.1"),
  eppMockPort: z.coerce.number().int().positive().default(7001),
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
  dnssecKeyPath: z.string().default("data/dnssec-keys.json")
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  const config = configSchema.parse({
    eppHost: env.EPP_HOST,
    eppPort: env.EPP_PORT,
    eppMockHost: env.EPP_MOCK_HOST,
    eppMockPort: env.EPP_MOCK_PORT,
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
    dnssecKeyPath: env.DNSSEC_KEY_PATH
  });

  validateProductionConfig(config, env);
  return config;
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
