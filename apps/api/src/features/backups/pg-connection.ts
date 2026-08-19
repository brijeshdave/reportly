// Author: Brijesh Dave <https://github.com/brijeshdave>
// Talking to pg_dump and pg_restore without handing them the password.
//
// This exists because of a real incident. The connection URL was passed to
// pg_dump as its dbname argument, and a password containing an unescaped `@`
// made pg_dump read part of it as a hostname:
//
//   pg_dump: error: could not translate host name "!@8989@postgres" to address
//
// That string was then stored on the backup row, shown in the UI, emailed as a
// failure notification, and written to the log — so a database password reached
// every holder of backups:manage and logs:read, and any log shipper downstream.
//
// Two defences, and the order matters. First: the credential is never in the
// command at all — host, port, user and database go as flags, and the password
// goes in the child's environment, which is not echoed back in error text.
// Second: whatever the tools do say is scrubbed before it is stored, logged or
// sent, because a message we have not seen yet is not a message to trust.
import { env } from "@/core/env.js";

/**
 * Let the password through a `docker exec` wrapper.
 *
 * PG_DUMP_CMD is often `docker exec -i <container> pg_dump`, and docker does not
 * carry the caller's environment into the container — so a password that travels
 * in the environment would simply not arrive, and pg_dump would sit there asking
 * for one. `-e PGPASSWORD` with no value tells docker to forward the variable it
 * already has, which keeps the secret off the command line where `ps` can read it.
 */
export function forwardPasswordThroughDocker(argv: string[]): string[] {
  const exec = argv.indexOf("exec");
  const isDocker = /(^|\/)docker$/.test(argv[0] ?? "");
  if (!isDocker || exec === -1 || argv.includes("PGPASSWORD")) return argv;
  return [...argv.slice(0, exec + 1), "-e", "PGPASSWORD", ...argv.slice(exec + 1)];
}

export interface PgTarget {
  /** `-h host -p port -U user -d name`, with nothing secret in it. */
  args: string[];
  /** Passed to the child process, never to the command line. */
  childEnv: NodeJS.ProcessEnv;
}

/**
 * Split a connection URL the way the app's own driver does.
 *
 * `new URL` takes everything up to the **last** `@` as the user info, which is
 * how node-postgres reads it too — so a password with an `@` in it resolves to
 * the same host the app is already connected to, rather than to the wrong one.
 */
export function pgTarget(connectionUrl: string): PgTarget {
  const url = new URL(connectionUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const args = ["-h", url.hostname, "-U", decodeURIComponent(url.username), "-d", database];
  if (url.port) args.splice(2, 0, "-p", url.port);

  return {
    args,
    childEnv: {
      ...process.env,
      // A percent-encoded password is decoded here for the same reason the driver
      // decodes it: `%40` in the URL is an `@` in the password.
      PGPASSWORD: safeDecode(url.password),
    },
  };
}

/** `decodeURIComponent` throws on a lone `%`; a password may legitimately hold one. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Remove anything credential-shaped from text on its way to a row, a log line or
 * a notification.
 *
 * Three passes, because each catches what the others miss: the user info of any
 * connection URL, the configured passwords themselves wherever they appear, and
 * a `PGPASSWORD=…` echo. The passwords are matched literally, so a fragment
 * quoted back inside an unrelated sentence — which is exactly how the incident
 * looked — is caught as well.
 */
export function redactSecrets(text: string): string {
  let out = text.replace(/([a-z+]+:\/\/)([^:/@\s]+):([^@\s]*)@/gi, "$1$2:[redacted]@");
  for (const secret of secretsToScrub()) {
    if (secret.length < 3) continue; // too short to match anything but noise
    out = out.split(secret).join("[redacted]");
  }
  return out.replace(/PGPASSWORD=\S+/g, "PGPASSWORD=[redacted]");
}

/** Every secret this process knows that could turn up in a tool's output. */
function secretsToScrub(): string[] {
  const values: string[] = [];
  for (const url of [env.DATABASE_URL, env.LOG_DATABASE_URL]) {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        values.push(parsed.password, safeDecode(parsed.password));
      }
    } catch {
      // An unparseable URL has nothing to take apart; the regex pass still applies.
    }
  }
  return [...new Set(values)];
}
