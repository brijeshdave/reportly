// Author: Brijesh Dave <https://github.com/brijeshdave>
// `cli doctor` — checks every external thing the app needs, and says which one is
// wrong. Written after a production image shipped without pg_dump: the backup
// feature shells out to it, so every backup failed, and nothing said so until
// someone opened the Backups screen and read a stack trace in an error column.
//
// The rule this encodes: if the app depends on something outside its own process,
// there is a check for it here. Readiness (`/ready`) answers "can I serve
// requests"; this answers "is this install actually complete", which is a longer
// list and the one an operator wants after a deploy or an env change.
import { randomUUID } from "node:crypto";

import { pingPool, appPool, logPool } from "@/core/db/pool.js";
import { env } from "@/core/env.js";
import {
  forwardPasswordThroughDocker,
  pgTarget,
  redactSecrets,
} from "@/features/backups/pg-connection.js";
import { verifyMailer } from "@/core/mail/mailer.js";
import { pingRedis } from "@/core/redis.js";
import { activeStorage } from "@/core/storage/index.js";
import { pgDumpArgv, pgRestoreArgv, runCapture } from "@/features/backups/service.js";

type Level = "ok" | "warn" | "fail";

interface Check {
  name: string;
  level: Level;
  detail: string;
}

const ok = (name: string, detail: string): Check => ({ name, level: "ok", detail });
const warn = (name: string, detail: string): Check => ({ name, level: "warn", detail });
const fail = (name: string, detail: string): Check => ({ name, level: "fail", detail });

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The server's major version, so the pg_dump check can compare against it. */
async function serverMajor(): Promise<number | null> {
  try {
    const { rows } = await appPool.query<{ v: string }>("SHOW server_version");
    const major = Number.parseInt(rows[0]?.v ?? "", 10);
    return Number.isNaN(major) ? null : major;
  } catch {
    return null;
  }
}

/** The major version a `pg_dump`-style binary reports, via `--version`. */
async function toolMajor(argv: string[]): Promise<{ major: number | null; raw: string }> {
  const [cmd, ...prefix] = argv;
  const { code, stdout, stderr } = await runCapture(cmd!, [...prefix, "--version"]);
  if (code !== 0) throw new Error(stderr.trim() || `exited ${code}`);
  const raw = stdout.toString().trim();
  const match = /(\d+)(?:\.\d+)?/.exec(raw);
  return { major: match ? Number(match[1]) : null, raw };
}

async function checkDatabases(): Promise<Check[]> {
  const [app, log] = await Promise.all([pingPool(appPool), pingPool(logPool)]);
  return [
    app
      ? ok("app database", "reachable")
      : fail("app database", `cannot reach ${redactUrl(env.DATABASE_URL)}`),
    log
      ? ok("log database", "reachable")
      : fail("log database", `cannot reach ${redactUrl(env.LOG_DATABASE_URL)}`),
  ];
}

/** A connection string with its password removed — this output gets pasted into issues. */
function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "(unparseable connection string)";
  }
}

async function checkRedis(): Promise<Check> {
  return (await pingRedis())
    ? ok("redis", "reachable")
    : fail(
        "redis",
        `cannot reach ${redactUrl(env.REDIS_URL)} — sessions, rate limits and queues need it`,
      );
}

async function checkMail(): Promise<Check> {
  try {
    await verifyMailer();
    return ok("smtp", `${env.SMTP_HOST}:${env.SMTP_PORT} accepted the connection`);
  } catch (err) {
    return fail(
      "smtp",
      `${env.SMTP_HOST}:${env.SMTP_PORT} — ${reason(err)}. ` +
        "Invitations and password resets are queued but never delivered until this works.",
    );
  }
}

/**
 * Storage is checked by writing, reading back and deleting a probe object, not by
 * looking at configuration. A directory that exists but is read-only — the usual
 * result of a missing volume mount — passes every check except this one.
 */
async function checkStorage(): Promise<Check> {
  const store = activeStorage();
  const key = `.doctor/${randomUUID()}`;
  const payload = Buffer.from("reportly doctor probe");
  try {
    await store.put(key, payload, "text/plain");
    const read = await store.get(key);
    if (!read.equals(payload)) {
      return fail("storage", `${store.name}: wrote a probe object but read back different bytes`);
    }
    return ok("storage", `${store.name}: writable (probe written, read and removed)`);
  } catch (err) {
    const where = store.name === "local" ? env.STORAGE_LOCAL_DIR : (env.S3_BUCKET ?? "(no bucket)");
    return fail(
      "storage",
      `${store.name} at ${where} — ${reason(err)}. ` +
        "Attachments, avatars and stored backups all go here.",
    );
  } finally {
    await store.delete(key).catch(() => {
      /* the probe is disposable; a failure to clean it up is not a finding */
    });
  }
}

/**
 * pg_dump and pg_restore must exist AND be at least the server's major version.
 * pg_dump refuses to dump a server newer than itself, so an older client is a
 * backup feature that looks configured and fails at the moment it is needed.
 */
/**
 * Can pg_dump actually reach the database?
 *
 * Existing and being new enough is not the same as working: the tools connect
 * with their own parser and their own network view, and a backup that only fails
 * at 2am is the worst way to find out. `--schema-only` with no output is the
 * cheapest thing that proves a real connection.
 */
async function checkBackupConnection(): Promise<Check> {
  const [cmd, ...prefix] = forwardPasswordThroughDocker(pgDumpArgv());
  try {
    const target = pgTarget(env.DATABASE_URL);
    const { code, stderr } = await runCapture(
      cmd!,
      [...prefix, "--schema-only", "--table", "___doctor_probe_does_not_exist", ...target.args],
      undefined,
      target.childEnv,
    );
    // A missing table is a fine answer — it proves we connected and were understood.
    if (code === 0 || /no matching tables/i.test(stderr)) {
      return ok("pg_dump connection", `reaches ${target.args[1]}`);
    }
    return fail("pg_dump connection", redactSecrets(stderr.trim()).slice(0, 300));
  } catch (err) {
    return fail("pg_dump connection", redactSecrets(reason(err)));
  }
}

/**
 * A password made of letters and digits, or a deployment that has thought about it.
 *
 * `@`, `/`, `:`, `#` and `?` are punctuation inside a URL, and the compose file
 * uses one value in two ways — raw as the Postgres password, and interpolated into
 * DATABASE_URL. Percent-encoding it there would fix the URL and break the login,
 * since the encoded text would become the literal password. So the workable answer
 * is a password that needs no encoding, and this says so before a backup discovers
 * it at two in the morning.
 */
function checkPasswordCharacters(): Check {
  let password: string;
  try {
    password = new URL(env.DATABASE_URL).password;
  } catch {
    return warn("database password", "DATABASE_URL could not be parsed to check it.");
  }

  const reserved = [...new Set([...password].filter((c) => "@/:#?&%".includes(c)))];
  if (reserved.length === 0) return ok("database password", "no characters that need encoding");

  return warn(
    "database password",
    `contains ${reserved.map((c) => `"${c}"`).join(", ")}, which a URL treats as punctuation. ` +
      "Tools that parse DATABASE_URL themselves may read the wrong host. Prefer a password " +
      "of letters and digits — with this compose file, percent-encoding it would change the " +
      "password itself.",
  );
}

async function checkBackupTools(): Promise<Check[]> {
  const server = await serverMajor();
  const checks: Check[] = [];

  for (const [label, argv] of [
    ["pg_dump", pgDumpArgv()],
    ["pg_restore", pgRestoreArgv()],
  ] as const) {
    try {
      const { major, raw } = await toolMajor(argv);
      if (server !== null && major !== null && major < server) {
        checks.push(
          fail(
            label,
            `${raw} is older than the server (${server}). ` +
              `${label} refuses to work across that gap — backups will fail.`,
          ),
        );
      } else {
        checks.push(ok(label, raw));
      }
    } catch (err) {
      checks.push(
        fail(
          label,
          `${argv.join(" ")} — ${reason(err)}. ` +
            "Backups and restores shell out to it; install a postgresql client, or point " +
            `${label === "pg_dump" ? "PG_DUMP_CMD" : "PG_RESTORE_CMD"} at one.`,
        ),
      );
    }
  }
  return checks;
}

/** Configuration that is legal but probably not what a production operator wants. */
function checkConfig(): Check[] {
  const checks: Check[] = [];

  if (env.NODE_ENV !== "production") {
    checks.push(warn("NODE_ENV", `${env.NODE_ENV} — production hardening checks are not applied`));
  }
  if (env.ALLOW_INSECURE_HTTP) {
    checks.push(
      warn(
        "ALLOW_INSECURE_HTTP",
        "on — session cookies lose the Secure flag and travel in clear text",
      ),
    );
  }
  if (env.NODE_ENV === "production" && env.TRUST_PROXY === "") {
    checks.push(
      warn(
        "TRUST_PROXY",
        "unset — behind a proxy, every rate limit and audit record sees the proxy, not the caller",
      ),
    );
  }
  return checks;
}

const SYMBOL: Record<Level, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };

/** Runs every check, prints a report, and returns true when nothing failed. */
export async function runDoctor(): Promise<boolean> {
  const checks: Check[] = [
    ...(await checkDatabases()),
    await checkRedis(),
    await checkMail(),
    await checkStorage(),
    checkPasswordCharacters(),
    ...(await checkBackupTools()),
    await checkBackupConnection(),
    ...checkConfig(),
  ];

  const width = Math.max(...checks.map((c) => c.name.length));
  console.log("");
  for (const check of checks) {
    console.log(`  [${SYMBOL[check.level]}] ${check.name.padEnd(width)}  ${check.detail}`);
  }

  const failures = checks.filter((c) => c.level === "fail");
  const warnings = checks.filter((c) => c.level === "warn");
  console.log("");
  if (failures.length === 0) {
    console.log(
      warnings.length === 0
        ? "All checks passed.\n"
        : `No failures, ${warnings.length} warning(s) worth a look.\n`,
    );
    return true;
  }
  console.log(
    `${failures.length} check(s) failed. Reportly will not work correctly until they do.\n`,
  );
  return false;
}
