// Author: Brijesh Dave <https://github.com/brijeshdave>
// Clear the e2e stack's own ports before Playwright tries to bind them.
//
// Playwright starts the API through `pnpm stack:api`, which spawns pnpm, which
// spawns tsx. Killing the run — Ctrl-C, a timeout, a crashed test — reliably takes
// the shell and leaves the grandchild listening, and the next run then dies before
// it starts with "http://localhost:3100/api/v1/health is already used". The suite
// deliberately does not set `reuseExistingServer`: a process on that port is a stale
// one from a killed run, pointed at who-knows-which database, and quietly talking to
// it would be worse than failing. So the answer is to clear it, not to adopt it.
//
// **It only ever kills a process belonging to this repository.** The pid on the port
// is checked against its own `/proc/<pid>/cwd` and command line first; anything else
// — somebody's unrelated server, another checkout — is left alone and reported, so
// this can never become the tool that killed the wrong thing on a shared machine.
import { execFileSync } from "node:child_process";
import { readFileSync, readlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { E2E_API_PORT, E2E_WEB_PORT, isExternalStack } from "./config.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Listener pids on a port. Empty when nothing is listening or `ss` is unavailable. */
function listenersOn(port: number): string[] {
  let output = "";
  try {
    output = execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8" });
  } catch {
    try {
      output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
        encoding: "utf8",
      });
      return [...new Set(output.split("\n").filter(Boolean))];
    } catch {
      return [];
    }
  }
  return [...new Set([...output.matchAll(/pid=(\d+)/g)].map((match) => match[1]!))];
}

/**
 * Whether a pid is one of ours: its working directory is inside this repository, or
 * its command line names a path inside it. Either is enough; neither means hands off.
 */
function belongsToThisRepo(pid: string): boolean {
  try {
    if (readlinkSync(`/proc/${pid}/cwd`).startsWith(REPO_ROOT)) return true;
  } catch {
    // No /proc, or not ours to read — fall through to the command line.
  }
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    return cmdline.includes(REPO_ROOT);
  } catch {
    return false;
  }
}

function describe(pid: string): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ").trim().slice(0, 120);
  } catch {
    return "(unknown process)";
  }
}

const sleep = (ms: number): "ok" | "not-equal" | "timed-out" =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function free(port: number): void {
  for (const pid of listenersOn(port)) {
    if (!belongsToThisRepo(pid)) {
      console.warn(
        `  port ${port} is held by pid ${pid}, which is not from this checkout — left alone.\n` +
          `    ${describe(pid)}\n` +
          `    Stop it yourself, or run the suite against it with BASE_URL set.`,
      );
      continue;
    }

    try {
      process.kill(Number(pid), "SIGTERM");
      // A moment to close listeners; then insist, because Playwright is about to
      // try the port and a slow exit reads exactly like a stuck one.
      sleep(400);
      try {
        process.kill(Number(pid), 0);
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // Already gone, which is the good case.
      }
      console.log(`  freed port ${port} (stale pid ${pid} from a previous run)`);
    } catch (error) {
      console.warn(`  could not free port ${port} (pid ${pid}): ${String(error)}`);
    }
  }
}

// A stack somebody else started — CI, or a developer pointing the suite at a running
// environment. We are a guest there and touch nothing.
if (isExternalStack()) {
  process.exit(0);
}

free(E2E_API_PORT);
free(E2E_WEB_PORT);
