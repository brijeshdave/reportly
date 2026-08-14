// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests via fastify.inject — no running infrastructure required.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp, API_PREFIX } from "../app.js";
import { REQUEST_ID_HEADER } from "../request-id.js";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("health endpoints", () => {
  it("GET /health reports liveness ok", async () => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/health` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(res.headers[REQUEST_ID_HEADER]).toBeDefined();
  });

  it("GET /ready returns a readiness report with dependency checks", async () => {
    // Infra may or may not be up in unit runs; assert the shape, not the verdict.
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/ready` });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json();
    expect(body.checks).toHaveProperty("appDb");
    expect(body.checks).toHaveProperty("logDb");
    expect(body.checks).toHaveProperty("redis");
  });

  it("propagates an inbound x-request-id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/health`,
      headers: { [REQUEST_ID_HEADER]: "trace-abc-123" },
    });
    expect(res.headers[REQUEST_ID_HEADER]).toBe("trace-abc-123");
  });
});

describe("error envelope", () => {
  it("unknown routes return the shared NOT_FOUND envelope", async () => {
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/does-not-exist` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
