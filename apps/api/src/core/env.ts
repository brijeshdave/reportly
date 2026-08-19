// Author: Brijesh Dave <https://github.com/brijeshdave>
// Validated environment loader — the single source of runtime configuration.
// Fails fast with a readable message when required variables are missing.
// Each variable carries a `.describe()`: the environment reference in /docs is
// generated from this schema, so it cannot drift from what the app accepts.
import { QUEUE_ADMIN_MODES } from "@reportly/shared";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

/**
 * A boolean from an environment variable, which is always a string.
 *
 * **Not `z.coerce.boolean()`**: that is `Boolean(value)`, and every non-empty
 * string is truthy — so `ALLOW_INSECURE_HTTP=false` switched insecure HTTP *on*.
 * An operator who writes the safe value explicitly, exactly as the documentation
 * shows, got the dangerous one. Found in production, 2026-08-19.
 *
 * Anything unrecognised fails the boot rather than guessing, in keeping with the
 * rest of this file: a misspelled flag is a question, not a default.
 */
const envBool = (fallback: boolean) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.enum(["true", "false", "1", "0", "yes", "no", "on", "off"]))
    .transform((value) => ["true", "1", "yes", "on"].includes(value))
    .default(fallback);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development")
    .describe(
      "Runtime mode. `production` refuses insecure defaults at boot (see `ALLOW_INSECURE_HTTP`).",
    ),
  ALLOW_INSECURE_HTTP: envBool(false).describe(
    "Permit `production` to run over plain HTTP. Session cookies then lose the `Secure` " +
      "flag and travel in clear text. Only for a trusted private network.",
  ),
  HOST: z.string().default("0.0.0.0").describe("Interface the API binds to."),
  PORT: z.coerce.number().int().positive().default(3000).describe("Port the API listens on."),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info")
    .describe("Floor for log output at startup. Per-feature levels are a runtime setting."),
  LOG_DIR: z.string().default("logs").describe("Directory for the rotating file sink."),

  // --- attachment storage ---
  STORAGE_BACKEND: z
    .enum(["local", "s3"])
    .default("local")
    .describe(
      "Where new attachments are written. Existing files keep the backend they were uploaded to until `cli storage:migrate` moves them.",
    ),
  STORAGE_LOCAL_DIR: z
    .string()
    .default("uploads")
    .describe(
      "Directory for the local backend. Must be a mounted volume: the container runs on a read-only root filesystem.",
    ),
  STORAGE_MAX_UPLOAD_MB: z.coerce
    .number()
    .int()
    .min(1)
    .max(1024)
    .default(50)
    .describe(
      "Hard ceiling on a single upload, enforced as it streams. This protects the server's memory; the per-organisation limit is the smaller `storage.uploads` setting. A request over this is cut off rather than read.",
    ),
  S3_ENDPOINT: z
    .string()
    .optional()
    .describe("S3 endpoint URL. Set it for MinIO/R2/Backblaze; omit it for AWS itself."),
  S3_REGION: z.string().default("us-east-1").describe("S3 region."),
  S3_BUCKET: z.string().optional().describe("Bucket attachments are written to."),
  S3_ACCESS_KEY_ID: z
    .string()
    .optional()
    .describe("S3 access key. Omit both key vars to use the instance's ambient credentials."),
  S3_SECRET_ACCESS_KEY: z.string().optional().describe("S3 secret key."),
  S3_FORCE_PATH_STYLE: z.coerce
    .boolean()
    .default(false)
    .describe("Use path-style URLs (`host/bucket/key`). MinIO needs this; AWS does not."),
  GEOIP_DB: z
    .string()
    .optional()
    .describe(
      "Path to a MaxMind GeoLite2 `.mmdb` for geolocating security-event IPs. " +
        "Unset (the default) records no location; see core/geoip.ts to enable.",
    ),
  ALLOW_REGISTRATION: envBool(false).describe(
    "Allow public self-service sign-up. Off by default — accounts are created by " +
      "an administrator or by invitation. Superadmin and invite flows are unaffected.",
  ),

  CORS_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .describe("Comma-separated list of browser origins allowed to call the API."),

  TRUST_PROXY: z
    .string()
    .default("")
    .describe(
      "How to derive the client IP when the API runs behind a reverse proxy. Empty (the " +
        "default) trusts no proxy — correct only when clients reach the API directly. Behind " +
        "the bundled nginx set `1` (trust one hop); or give a comma-separated list of trusted " +
        "proxy IPs/CIDRs. Without it, per-IP rate limits and audit IPs all see the proxy, not " +
        "the client. Never set `true` on a public listener: any client could then spoof its IP.",
    ),

  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://reportly:reportly@localhost:5432/reportly")
    .describe("Application Postgres database."),
  LOG_DATABASE_URL: z
    .string()
    .url()
    .default("postgres://reportly:reportly@localhost:5432/reportly_logs")
    .describe("Separate Postgres database for logs, so log volume never affects the app."),
  // The pg_dump/pg_restore invocation used for database backups. Just the binary by
  // default; override to run the client elsewhere when the API host has none — e.g.
  // `docker exec -i reportly-postgres-1 pg_dump` in a compose dev setup. Split on spaces.
  PG_DUMP_CMD: z
    .string()
    .default("pg_dump")
    .describe("Command (argv, space-split) used to run pg_dump for backups."),
  PG_RESTORE_CMD: z
    .string()
    .default("pg_restore")
    .describe("Command (argv, space-split) used to run pg_restore for restores."),
  /**
   * How much of the queue-management feature the API exposes.
   *
   * `off` means the routes are never registered — `/queues` is a 404 because
   * nothing is mounted, not because a guard refused. A feature that is "disabled"
   * but still has a live handler is a feature you are still exposed to, and one
   * bug away from being enabled.
   *
   * `read` mounts the GETs only, so a mutating call has no handler to reach
   * whatever permission the caller holds. `manage` adds retry, remove, pause and
   * clean.
   *
   * Off by default and deliberately so: upgrading a server must never silently
   * expose a screen that can pause the queue carrying every password reset.
   */
  /**
   * Lets `cli restore:dev` wipe this database and load a production dump into it.
   *
   * Off unless set, and refused outright when NODE_ENV is production or the
   * database is not local. A command that drops a database should take more than
   * one mistake to fire.
   */
  ALLOW_DEV_RESTORE: z
    .enum(["true", "false"])
    .default("false")
    .describe(
      "Set `true` to allow `cli restore:dev` to wipe this database and load a " +
        "production backup into it. Development machines only.",
    ),
  QUEUE_ADMIN: z
    .enum(QUEUE_ADMIN_MODES)
    .default("off")
    .describe(
      "Queue management: `off` (default, routes not mounted), `read` (view only), " +
        "or `manage` (retry, remove, pause, clean).",
    ),
  REDIS_URL: z
    .string()
    .url()
    .default("redis://localhost:6379")
    .describe(
      "Redis for sessions, caches, rate limits and the job queue. The `/N` db index is honoured.",
    ),

  BETTER_AUTH_SECRET: z
    .string()
    .min(16)
    .default("dev-only-insecure-secret-change-me")
    .describe("Signs sessions and cookies. **Must** be replaced in every real environment."),
  BETTER_AUTH_URL: z
    .string()
    .url()
    .default("http://localhost:3000")
    .describe("The API's externally reachable origin, used to build auth callback URLs."),

  SMTP_HOST: z.string().default("localhost").describe("Outbound mail host (dev: Mailpit)."),
  SMTP_PORT: z.coerce.number().int().positive().default(1025).describe("Outbound mail port."),
  SMTP_SECURE: envBool(false).describe("Use TLS when connecting to SMTP."),
  SMTP_USER: z.string().optional().describe("SMTP username, when the relay requires one."),
  SMTP_PASS: z.string().optional().describe("SMTP password, when the relay requires one."),
  MAIL_FROM: z
    .string()
    .default("Reportly <no-reply@reportly.local>")
    .describe("From address on invitations and password-reset emails."),
  WEB_URL: z
    .string()
    .url()
    .default("http://localhost:5173")
    .describe("Where the web app is served. Emailed links point here."),

  SUPERADMIN_EMAIL: z
    .string()
    .email()
    .default("admin@reportly.local")
    .describe("Seeded superadmin. Set its password with `cli reset-superadmin`."),
  SUPERADMIN_NAME: z.string().min(1).default("Super Admin").describe("Seeded superadmin's name."),
});

export type Env = z.infer<typeof envSchema>;

export const INSECURE_SECRET = "dev-only-insecure-secret-change-me";

/**
 * Loopback is a secure context to a browser, so plain HTTP there is not a finding
 * — that is what a production-style compose run on localhost is.
 */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * The defaults that make development pleasant are the ones that make production
 * unsafe, and every one of them fails silently: a shipped signing secret forges
 * every session, and an `http` origin means the session cookie is sent without
 * `Secure` and can be read off the wire. Neither shows up as an error — the app
 * just works, insecurely. So production refuses to boot instead of downgrading.
 *
 * Plain HTTP on a real hostname stays available behind `ALLOW_INSECURE_HTTP`,
 * because a self-hosted install on a trusted private network is a real
 * deployment. It just has to be asked for rather than fallen into.
 */
export function productionSecurityErrors(env: Env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const errors: string[] = [];

  if (env.BETTER_AUTH_SECRET === INSECURE_SECRET) {
    errors.push(
      "BETTER_AUTH_SECRET is still the development default — every session cookie would be forgeable.",
    );
  }

  if (!env.ALLOW_INSECURE_HTTP) {
    for (const key of ["BETTER_AUTH_URL", "WEB_URL"] as const) {
      const url = env[key];
      if (!url.startsWith("https://") && !isLoopback(url)) {
        errors.push(
          `${key} is not https (${url}). Session cookies would lose the Secure flag and travel ` +
            "in clear text. Set ALLOW_INSECURE_HTTP=true if this is a trusted private network.",
        );
      }
    }
  }

  return errors;
}

/**
 * Storage settings that are incomplete rather than insecure.
 *
 * Selecting the S3 backend without a bucket is not a thing to discover when the
 * first person tries to attach a photo to a breakdown report and gets a 500. It is
 * a startup problem, so it fails at startup. This is not a `superRefine` on the
 * schema because the env docs generator reads `envSchema.shape`, and wrapping the
 * object in a ZodEffects would take that away.
 */
export function storageConfigErrors(env: Env): string[] {
  if (env.STORAGE_BACKEND !== "s3") return [];
  const errors: string[] = [];

  if (!env.S3_BUCKET) {
    errors.push("STORAGE_BACKEND is s3 but S3_BUCKET is not set — there is nowhere to write.");
  }
  // One key without the other is always a typo, and it fails as a confusing
  // permission error at the far end rather than as the missing variable it is.
  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
    errors.push(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together (or both omitted, to use ambient credentials).",
    );
  }

  return errors;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const storage = storageConfigErrors(parsed.data);
  if (storage.length > 0) {
    throw new Error(
      `Invalid storage configuration:\n${storage.map((error) => `  - ${error}`).join("\n")}`,
    );
  }

  const insecure = productionSecurityErrors(parsed.data);
  if (insecure.length > 0) {
    throw new Error(
      `Refusing to start in production with an insecure configuration:\n${insecure
        .map((error) => `  - ${error}`)
        .join("\n")}`,
    );
  }

  return parsed.data;
}

export const env: Env = loadEnv();

/** Session cookies carry `Secure` whenever the app is actually reachable over TLS. */
export const useSecureCookies: boolean = env.BETTER_AUTH_URL.startsWith("https://");

/**
 * `TRUST_PROXY` as Fastify wants it: a hop count, a list of trusted proxy
 * addresses, or `false` for none. A bare `true` is deliberately reachable only
 * by writing it out — trusting an unbounded `X-Forwarded-For` lets any client
 * forge its own IP, which is worse than seeing the proxy's.
 */
export function parseTrustProxy(value: string): boolean | number | string[] {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "false") return false;
  if (trimmed.toLowerCase() === "true") return true;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const trustProxy: boolean | number | string[] = parseTrustProxy(env.TRUST_PROXY);

/**
 * Whether the client IP is derived from a forwarded header. When it is, better-auth
 * is told to read the same header so its own per-IP rate limiting sees the client
 * and not the proxy — but only then, so a direct client can never spoof it.
 */
export const trustsForwardedIp: boolean = trustProxy !== false;

/** Parsed list form of CORS_ORIGIN for the CORS plugin. */
export const corsOrigins: string[] = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
