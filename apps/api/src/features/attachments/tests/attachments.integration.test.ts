// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for attachments — the round trip, the limits, and the two rules
// that keep files and records honest:
//   - a file is as private as the record it hangs off; the visibility rule is the
//     report's own, not a copy of it
//   - deleting a report takes its files with it (no foreign key does this)
//   - the limits are the server's, not the browser's
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";

const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const TEMP_PW = "Str0ngTempPass!x";
const OWN_PW = "TheirOwnP4ss!ok";

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

function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

/** A multipart body with one file part, built by hand so no client is involved. */
function multipart(filename: string, contentType: string, body: Buffer) {
  const boundary = "----reportlytestboundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, body, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function upload(
  cookie: string,
  reportId: string,
  filename: string,
  contentType: string,
  body: Buffer,
) {
  const { payload, headers } = multipart(filename, contentType, body);
  return app.inject({
    method: "POST",
    url: `${API_PREFIX}/journal/${reportId}/attachments`,
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID, ...headers },
    payload,
  });
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

async function makeUser(
  admin: string,
  name: string,
  username: string,
  groupId: string,
): Promise<{ id: string; cookie: string }> {
  const created = await inject("POST", "/users", admin, {
    name,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
  // Company access belongs to the person now, not to their group.
  await inject("PUT", `/users/${id}/companies`, admin, { ids: [DEMO_COMPANY_ID] });

  const assignments = (await inject("GET", `/groups/${groupId}/assignments`, admin)).json();
  await inject("PUT", `/groups/${groupId}/users`, admin, { ids: [...assignments.users, id] });

  const gated = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/username`,
    payload: { username, password: TEMP_PW },
  });
  await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/change-password`,
    headers: { cookie: cookieFrom(gated) },
    payload: { currentPassword: TEMP_PW, newPassword: OWN_PW },
  });
  const clean = await app.inject({
    method: "POST",
    url: `${API_PREFIX}/auth/sign-in/username`,
    payload: { username, password: OWN_PW },
  });
  return { id, cookie: cookieFrom(clean) };
}

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

/** An author with a submitted report, and an unrelated person in another chain. */
async function setup(admin: string) {
  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);
  const stranger = await makeUser(admin, "Kim Elsewhere", "kim", memberGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: author.id, rank: "member" },
      { userId: stranger.id, rank: "member" },
    ],
  });

  const report = (
    await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Belt seized",
      state: "submitted",
    })
  ).json();

  return { author, stranger, report };
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/**
 * Move a report to the first finished status.
 *
 * Appraisal now requires it: a mark is for work that was done, and a report still
 * in progress has not finished being done. Every test that scores a report goes
 * through here rather than repeating the lookup.
 */
async function finish(cookie: string, reportId: string): Promise<void> {
  const statuses = (await inject("GET", "/journal-statuses", cookie)).json();
  const resolved = statuses.find((s: { name: string }) => s.name === "Resolved");
  const res = await inject("PATCH", `/journal/${reportId}/status`, cookie, {
    statusId: resolved.id,
  });
  expect(res.statusCode).toBe(200);
}

describe("attachments", () => {
  it("round-trips a file through upload, list and download", async () => {
    const admin = await superadmin();
    const { author, report } = await setup(admin);

    const created = await upload(author.cookie, report.id, "belt.png", "image/png", PNG);
    expect(created.statusCode).toBe(201);
    const attachment = created.json();
    expect(attachment.filename).toBe("belt.png");
    expect(attachment.size).toBe(PNG.length);
    expect(attachment.backend).toBe("local");
    expect(attachment.uploadedByName).toBe("Sam Operator");
    // The storage key is internal and must not be handed to clients.
    expect(attachment.key).toBeUndefined();

    const listed = (await inject("GET", `/journal/${report.id}/attachments`, author.cookie)).json();
    expect(listed).toHaveLength(1);

    // The bytes come back exactly as they went in.
    const got = await inject("GET", `/attachments/${attachment.id}`, author.cookie);
    expect(got.statusCode).toBe(200);
    expect(Buffer.from(got.rawPayload).equals(PNG)).toBe(true);

    // Served as a download, never inline: an HTML file rendered inline from our own
    // origin would run its script against the session cookie.
    expect(got.headers["content-disposition"]).toContain("attachment;");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");

    expect(
      (await inject("DELETE", `/attachments/${attachment.id}`, author.cookie)).statusCode,
    ).toBe(204);
    expect(
      (await inject("GET", `/journal/${report.id}/attachments`, author.cookie)).json(),
    ).toEqual([]);
  });

  it("makes a file exactly as private as the report it hangs off", async () => {
    const admin = await superadmin();
    const { author, stranger, report } = await setup(admin);

    const attachment = (
      await upload(author.cookie, report.id, "belt.png", "image/png", PNG)
    ).json();

    // Nobody above them in the line, so the report is not theirs to see — and
    // neither is its file. 404, not 403: the existence is not theirs either.
    expect((await inject("GET", `/journal/${report.id}`, stranger.cookie)).statusCode).toBe(404);
    expect((await inject("GET", `/attachments/${attachment.id}`, stranger.cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await inject("GET", `/journal/${report.id}/attachments`, stranger.cookie)).statusCode,
    ).toBe(404);

    // And they cannot put one there either.
    expect((await upload(stranger.cookie, report.id, "x.png", "image/png", PNG)).statusCode).toBe(
      404,
    );
  });

  it("enforces the type and size limits server-side", async () => {
    const admin = await superadmin();
    const { author, report } = await setup(admin);

    // A type outside the allowlist. An allowlist, so this needs no new rule to
    // refuse a .exe — it was never on the list in the first place.
    const exe = await upload(author.cookie, report.id, "tool.exe", "application/x-msdownload", PNG);
    expect(exe.statusCode).toBe(415);

    // Empty files are nothing to keep.
    expect(
      (await upload(author.cookie, report.id, "empty.png", "image/png", Buffer.alloc(0)))
        .statusCode,
    ).toBe(400);

    // Over the configured size. Shrink the limit rather than send 25 MB.
    await inject("PUT", "/settings/storage/uploads", admin, {
      value: { maxFileSizeMb: 1, maxFilesPerOwner: 20, allowedTypes: ["image/png"] },
    });
    const big = await upload(
      author.cookie,
      report.id,
      "huge.png",
      "image/png",
      Buffer.alloc(2 * 1024 * 1024, 1),
    );
    expect(big.statusCode).toBe(413);

    // The same file under the limit is fine, so it was the size that was refused.
    expect((await upload(author.cookie, report.id, "ok.png", "image/png", PNG)).statusCode).toBe(
      201,
    );
  });

  it("refuses to change files on a scored report until it is re-opened", async () => {
    const admin = await superadmin();
    const { author, report } = await setup(admin);

    // A file is part of what was scored, so it follows the report's content lock —
    // unlike downtime, which has to stay editable after the work is scored.
    await finish(author.cookie, report.id);
    await inject("PUT", `/journal/${report.id}/scores`, author.cookie, {
      scores: [{ userId: author.id, points: 7 }],
    });

    const locked = await upload(author.cookie, report.id, "late.png", "image/png", PNG);
    expect(locked.statusCode).toBe(409);

    await inject("POST", `/journal/${report.id}/reopen`, author.cookie);
    expect((await upload(author.cookie, report.id, "late.png", "image/png", PNG)).statusCode).toBe(
      201,
    );
  });

  it("takes a report's files with it when the report is deleted", async () => {
    const admin = await superadmin();
    const { author, report } = await setup(admin);

    const attachment = (
      await upload(author.cookie, report.id, "belt.png", "image/png", PNG)
    ).json();

    // No foreign key does this — the owner link is polymorphic — so if the service
    // ever stops cleaning up, the row outlives its report and this catches it.
    expect((await inject("DELETE", `/journal/${report.id}`, author.cookie)).statusCode).toBe(204);
    expect((await inject("GET", `/attachments/${attachment.id}`, admin)).statusCode).toBe(404);
  });
});
