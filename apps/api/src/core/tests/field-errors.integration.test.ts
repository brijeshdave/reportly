// Author: Brijesh Dave <https://github.com/brijeshdave>
// A refusal says which field it is about.
//
// Reported from use: a form that breaks a rule showed "that generic api kind of error
// message on top not in ui fields". The API knew exactly which input it meant — a zod
// issue carries its path — and threw that away on the way out, leaving the browser
// nothing to attribute. It now travels as `error.fields`, keyed the way
// @reportly/shared keys it, because the browser validates against these same schemas
// and the two must agree or the message lands nowhere.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
});

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

describe("the error envelope", () => {
  it("names the body field a validation failure is about", async () => {
    const admin = await superadmin();
    // `kind` is a fixed set and `title` is required. Two fields, which is the case a
    // single sentence cannot serve: a person told "Request validation failed" has to
    // guess which of the inputs on the screen was meant.
    const res = await inject("POST", "/journal", admin, { kind: "nonsense" });

    expect(res.statusCode).toBe(400);
    const { error } = res.json();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.fields).toBeDefined();
    expect(Object.keys(error.fields)).toContain("kind");
    expect(Object.keys(error.fields)).toContain("title");
    // A message, not a code — it goes straight under an input for a person to read.
    expect(typeof error.fields.kind).toBe("string");
    expect(error.fields.kind.length).toBeGreaterThan(0);
  });

  it("keys a nested field by its path, the way a form indexes its state", async () => {
    const admin = await superadmin();
    const res = await inject("POST", "/journal", admin, {
      kind: "issue",
      title: "Belt snapped",
      targets: [{ kind: "nonsense", id: "anything" }],
    });

    expect(res.statusCode).toBe(400);
    // Dotted, with the array index as a segment: the row the person typed into.
    expect(Object.keys(res.json().error.fields)).toContain("targets.0.kind");
  });

  it("refuses a malformed id in the scope rather than failing on it", async () => {
    // User input must not produce a 500. `targets[].id` is typed as a plain string
    // because a person is keyed by text while everything else is keyed by uuid — so
    // a hand-made body (or a stale link) put "not-a-uuid" straight into a uuid
    // column, Postgres refused the cast, and the request ended as a server error
    // instead of "that is not in this company".
    const admin = await superadmin();
    const res = await inject("POST", "/journal", admin, {
      kind: "issue",
      title: "Belt snapped",
      state: "draft",
      targets: [{ kind: "asset", id: "not-a-uuid" }],
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/not in this company/i);
  });

  it("carries no fields for a refusal that has none", async () => {
    // A 401 is not about anything the person typed, and a client that showed it
    // against an input would be blaming a field for a missing session.
    const res = await app.inject({ method: "GET", url: `${API_PREFIX}/journal` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.fields).toBeUndefined();
  });

  it("does not blame a field for a bad route parameter", async () => {
    // The id is in the path, not on the form. There is no input to put a message
    // under, so this stays the sentence it always was.
    const admin = await superadmin();
    const res = await inject("GET", "/journal/not-a-uuid", admin);
    expect(res.json().error.fields).toBeUndefined();
  });
});
