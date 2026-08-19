// Author: Brijesh Dave <https://github.com/brijeshdave>
// The incident these tests exist for: a database password containing an `@` was
// passed to pg_dump inside a connection URL, pg_dump quoted the mangled string
// back in its error, and that error was stored on the backup row, shown in the
// UI, emailed as a notification and written to the log.
//
// So two properties are pinned here — the password never reaches the command
// line, and nothing credential-shaped survives on its way to a row, a log line or
// a notification.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/env.js", () => ({
  env: {
    DATABASE_URL: "postgres://reportly:!@8989@postgres:5432/reportly",
    LOG_DATABASE_URL: "postgres://reportly:!@8989@postgres:5432/reportly_logs",
  },
}));

const { forwardPasswordThroughDocker, pgTarget, redactSecrets } =
  await import("@/features/backups/pg-connection.js");

describe("pgTarget", () => {
  it("splits a password containing @ the way the app's own driver does", () => {
    const target = pgTarget("postgres://reportly:!@8989@postgres:5432/reportly");

    // The host is `postgres`, not `!@8989@postgres` — the failure that started this.
    expect(target.args).toEqual([
      "-h",
      "postgres",
      "-p",
      "5432",
      "-U",
      "reportly",
      "-d",
      "reportly",
    ]);
  });

  it("keeps the password out of the arguments entirely", () => {
    const target = pgTarget("postgres://reportly:!@8989@postgres:5432/reportly");

    expect(target.args.join(" ")).not.toContain("8989");
    expect(target.childEnv.PGPASSWORD).toBe("!@8989");
  });

  it("decodes a percent-encoded password, as the driver does", () => {
    const target = pgTarget("postgres://reportly:p%40ss%21word@localhost:5432/reportly");

    expect(target.childEnv.PGPASSWORD).toBe("p@ss!word");
    expect(target.args).toContain("localhost");
  });

  it("survives a password holding a lone percent sign", () => {
    const target = pgTarget("postgres://reportly:100%pure@localhost/reportly");

    // decodeURIComponent throws on this; a thrown backup is worse than a raw one.
    expect(target.childEnv.PGPASSWORD).toBe("100%pure");
  });
});

describe("forwardPasswordThroughDocker", () => {
  it("forwards the variable through a docker exec wrapper", () => {
    const argv = forwardPasswordThroughDocker(["docker", "exec", "-i", "pg", "pg_dump"]);

    // `-e PGPASSWORD` with no value: docker carries the variable it already has,
    // and the secret never appears in a command line that `ps` can read.
    expect(argv).toEqual(["docker", "exec", "-e", "PGPASSWORD", "-i", "pg", "pg_dump"]);
  });

  it("leaves a plain command alone", () => {
    expect(forwardPasswordThroughDocker(["pg_dump"])).toEqual(["pg_dump"]);
  });

  it("does not double up when the operator already forwards it", () => {
    const argv = ["docker", "exec", "-e", "PGPASSWORD", "pg", "pg_dump"];
    expect(forwardPasswordThroughDocker(argv)).toEqual(argv);
  });
});

describe("redactSecrets", () => {
  it("removes the password from the message that caused the incident", () => {
    const real = 'pg_dump: error: could not translate host name "!@8989@postgres" to address';

    const safe = redactSecrets(real);
    expect(safe).not.toContain("8989");
    expect(safe).toContain("[redacted]");
  });

  it("removes the user info from any connection URL it is shown", () => {
    const safe = redactSecrets("could not connect to postgres://reportly:hunter2@db:5432/x");

    expect(safe).not.toContain("hunter2");
    expect(safe).toContain("postgres://reportly:[redacted]@db:5432/x");
  });

  it("removes a PGPASSWORD echoed back by a tool", () => {
    expect(redactSecrets("env: PGPASSWORD=swordfish set")).toBe("env: PGPASSWORD=[redacted] set");
  });

  it("leaves an innocent message alone", () => {
    const message = 'pg_dump: error: connection to server at "db" failed: timeout expired';
    expect(redactSecrets(message)).toBe(message);
  });
});
