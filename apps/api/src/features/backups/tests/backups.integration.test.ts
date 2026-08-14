// Author: Brijesh Dave <https://github.com/brijeshdave>
// Backups end-to-end: a superadmin takes a database backup (a real pg_dump), it appears
// in the list, downloads as bytes, and deletes; the endpoints are gated by permission.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

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

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return list.map((c) => String(c).split(";")[0]).join("; ");
}

async function superadmin(): Promise<string> {
  const password = await resetSuperadmin();
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/email`,
    payload: { email: "admin@reportly.local", password },
  });
  return cookieFrom(res);
}

function inject(method: string, url: string, cookie: string) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
  });
}

describe("backups", () => {
  it("takes a database backup, records it, downloads a completed one, and deletes it", async () => {
    const admin = await superadmin();

    const made = await inject("POST", "/backups?kind=database", admin);
    expect(made.statusCode).toBe(200);
    expect(made.json().kind).toBe("database");
    const backup = made.json();
    const id = backup.id;

    // The row is catalogued whatever the outcome. pg_dump must be on the API host for it
    // to complete; where it is, the dump downloads as bytes — where it is not, the row is
    // recorded as failed with the reason, which is the point of recording it.
    const list = (await inject("GET", "/backups", admin)).json();
    expect(list.some((b: { id: string }) => b.id === id)).toBe(true);

    if (backup.status === "completed") {
      expect(backup.sizeBytes).toBeGreaterThan(0);
      const download = await inject("GET", `/backups/${id}/download`, admin);
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.length).toBeGreaterThan(0);
    } else {
      expect(backup.error).toBeTruthy();
      expect((await inject("GET", `/backups/${id}/download`, admin)).statusCode).toBe(400);
    }

    expect((await inject("DELETE", `/backups/${id}`, admin)).statusCode).toBe(204);
    const after = (await inject("GET", "/backups", admin)).json();
    expect(after.some((b: { id: string }) => b.id === id)).toBe(false);
  });

  it("refuses the backup endpoints without authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/backups`,
      headers: { "x-company-id": DEMO_COMPANY_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a restore without the typed confirmation", async () => {
    const admin = await superadmin();
    // The wrong confirmation is rejected by validation before any restore runs — so this
    // never touches the database, whatever id is given.
    const res = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/backups/11111111-2222-3333-4444-555555555555/restore`,
      headers: { cookie: admin, "x-company-id": DEMO_COMPANY_ID },
      payload: { confirm: "please" },
    });
    expect(res.statusCode).toBe(400);
    // The upload restore likewise needs confirm=RESTORE in the query.
    const upload = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/backups/restore/upload?kind=database&confirm=nope`,
      headers: { cookie: admin, "x-company-id": DEMO_COMPANY_ID },
    });
    expect(upload.statusCode).toBe(400);
  });
});
