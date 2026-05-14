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
  controlHost: z.string().default("127.0.0.1"),
  controlPort: z.coerce.number().int().positive().default(8080),
  greetingServerId: z.string().default("epp-testing-tool"),
  authUsers: z.array(authUserSchema).min(1).default(defaultAuthUsers),
  resetHttpUser: z.string().default("admin"),
  resetHttpPassword: z.string().default("reset-secret"),
  storageMode: z.enum(["memory", "sqlite"]).default("sqlite"),
  sqlitePath: z.string().default("data/epp-testing-tool.sqlite")
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): AppConfig {
  return configSchema.parse({
    eppHost: env.EPP_HOST,
    eppPort: env.EPP_PORT,
    controlHost: env.CONTROL_HOST,
    controlPort: env.CONTROL_PORT,
    greetingServerId: env.GREETING_SERVER_ID,
    authUsers: loadAuthUsers(env),
    resetHttpUser: env.RESET_HTTP_USER,
    resetHttpPassword: env.RESET_HTTP_PASSWORD,
    storageMode: env.STORAGE_MODE,
    sqlitePath: env.SQLITE_PATH
  });
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
