// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for profile pictures: what is accepted, what is refused, and
// who may change whose.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const SUPERADMIN_USER_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "Str0ngPassw0rd!x";

/** The smallest real PNG: an 8-byte signature is what the sniffer looks for. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]).toString("base64");

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

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie },
    payload: payload as object,
  });
}

/** A plain member: signed up, in no group, holding no permissions. */
async function member(): Promise<{ id: string; cookie: string }> {
  const res = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-up/email`,
    payload: { email: "member@reportly.test", password: PASSWORD, name: "Member" },
  });
  return { id: res.json().user.id as string, cookie: cookieFrom(res) };
}

describe("profile pictures", () => {
  it("stores a picture and serves it back", async () => {
    const cookie = await superadmin();

    const put = await inject("PUT", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie, { data: PNG });
    expect(put.statusCode).toBe(200);
    expect(put.json().version).toBeGreaterThan(0);

    const get = await inject("GET", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie);
    expect(get.statusCode).toBe(200);
    expect(get.headers["content-type"]).toBe("image/png");
    expect(get.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it("tells the user list which people have one, without shipping the bytes", async () => {
    const cookie = await superadmin();
    await inject("PUT", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie, { data: PNG });

    const users = (await inject("GET", "/users", cookie)).json().data;
    const admin = users.find((u: { id: string }) => u.id === SUPERADMIN_USER_ID);
    expect(admin.avatarVersion).toBeGreaterThan(0);
    // The image itself must never ride along in a listing.
    expect(JSON.stringify(users)).not.toContain(PNG.slice(0, 24));
  });

  it("serves a 304 when the browser already has that version", async () => {
    const cookie = await superadmin();
    await inject("PUT", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie, { data: PNG });

    const first = await inject("GET", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie);
    const etag = first.headers.etag as string;

    const again = await app.inject({
      method: "GET",
      url: `${API_PREFIX}/users/${SUPERADMIN_USER_ID}/avatar`,
      headers: { cookie, "if-none-match": etag },
    });
    expect(again.statusCode).toBe(304);
  });

  it("refuses anything that is not really an image", async () => {
    const cookie = await superadmin();

    // A believable filename and content-type prove nothing: the bytes are read.
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");
    const res = await inject("PUT", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie, { data: html });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/PNG, JPEG and WebP/i);
  });

  it("refuses an image that is too large", async () => {
    const cookie = await superadmin();
    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(600 * 1024, 1),
    ]).toString("base64");

    const res = await inject("PUT", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie, { data: huge });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/too large/i);
  });

  it("lets a user set their own, but not somebody else's", async () => {
    const target = await member();

    // Their own: allowed, with no permission at all.
    expect(
      (await inject("PUT", `/users/${target.id}/avatar`, target.cookie, { data: PNG })).statusCode,
    ).toBe(200);

    // Somebody else's: refused — that needs users:update.
    const other = await inject("PUT", `/users/${SUPERADMIN_USER_ID}/avatar`, target.cookie, {
      data: PNG,
    });
    expect(other.statusCode).toBe(403);
  });

  it("removes a picture", async () => {
    const cookie = await superadmin();
    await inject("PUT", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie, { data: PNG });

    expect((await inject("DELETE", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie)).statusCode).toBe(
      204,
    );
    expect((await inject("GET", `/users/${SUPERADMIN_USER_ID}/avatar`, cookie)).statusCode).toBe(
      404,
    );
    expect((await inject("GET", `/users/${SUPERADMIN_USER_ID}`, cookie)).json().avatarVersion).toBe(
      null,
    );
  });
});
