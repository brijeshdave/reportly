// Author: Brijesh Dave <https://github.com/brijeshdave>
// `QUEUE_ADMIN` decides what EXISTS, not what gets refused.
//
// The distinction is the whole point of the switch, and it is invisible in the
// source: a 403 and a 404 both look like "denied" from a browser. These build the
// app three times, once per mode, and assert on the status code — because "the
// feature is off" has to mean the handler is not there, not that a guard said no.
// A guard is one bug away from saying yes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL = process.env.QUEUE_ADMIN;

async function buildWith(mode: string) {
  process.env.QUEUE_ADMIN = mode;
  // The env module parses once at import, and the routes read it at registration,
  // so both have to be re-imported for a new mode to take effect.
  vi.resetModules();
  const { buildApp, API_PREFIX } = await import("@/core/app.js");
  const app = await buildApp();
  await app.ready();
  return { app, API_PREFIX };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.QUEUE_ADMIN;
  else process.env.QUEUE_ADMIN = ORIGINAL;
  vi.resetModules();
});

describe("QUEUE_ADMIN=off", () => {
  it("does not mount the queue routes at all", async () => {
    const { app, API_PREFIX } = await buildWith("off");
    try {
      // 404, not 401 or 403: there is no route, so authentication never runs.
      // If this ever becomes a 401 the handler exists again and the switch has
      // quietly turned into a guard.
      for (const path of ["/queues", "/queues/email", "/queues/email/jobs"]) {
        const res = await app.inject({ method: "GET", url: `${API_PREFIX}${path}` });
        expect(res.statusCode, `${path} should not exist`).toBe(404);
      }
      const paused = await app.inject({ method: "POST", url: `${API_PREFIX}/queues/email/pause` });
      expect(paused.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe("QUEUE_ADMIN=read", () => {
  it("mounts the reads but not the mutations", async () => {
    const { app, API_PREFIX } = await buildWith("read");
    try {
      // The GET exists, so it demands a session (401) rather than not existing.
      const list = await app.inject({ method: "GET", url: `${API_PREFIX}/queues` });
      expect(list.statusCode).toBe(401);

      // The mutations are absent entirely, so holding queues:manage on a
      // read-only install is not a state anyone has to reason about.
      for (const path of ["/queues/email/pause", "/queues/email/resume", "/queues/email/clean"]) {
        const res = await app.inject({ method: "POST", url: `${API_PREFIX}${path}` });
        expect(res.statusCode, `${path} should not exist in read mode`).toBe(404);
      }
      const removed = await app.inject({
        method: "DELETE",
        url: `${API_PREFIX}/queues/email/jobs/1`,
      });
      expect(removed.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe("QUEUE_ADMIN=manage", () => {
  it("mounts everything, still behind a session", async () => {
    const { app, API_PREFIX } = await buildWith("manage");
    try {
      const list = await app.inject({ method: "GET", url: `${API_PREFIX}/queues` });
      expect(list.statusCode).toBe(401);
      const paused = await app.inject({ method: "POST", url: `${API_PREFIX}/queues/email/pause` });
      expect(paused.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
