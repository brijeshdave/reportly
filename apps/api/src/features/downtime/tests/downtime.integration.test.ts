// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for downtime — the second clock, and the one the plant argues
// about at the end of the month:
//   - an entry opens with no end time, sits in the pending queue, and is closed by
//     editing it; the duration is the span, not the report's work time
//   - the per-thing total is what all of that adds up to, and a still-open outage
//     keeps counting rather than reading as zero
//   - downtime may only be recorded on something the report is actually about
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
  const roles = (await inject("GET", "/roles", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

/** An author, a line they can name, and a report already scoped to that line. */
async function setup(admin: string) {
  const memberGroup = await makeGroup(admin, "Reporters", "Member");
  const author = await makeUser(admin, "Sam Operator", "sam", memberGroup);
  const dept = (await inject("POST", "/departments", admin, { name: "Assembly" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [{ userId: author.id, rank: "member" }],
  });

  const line = (await inject("POST", "/assets", admin, { name: "Line 3" })).json();
  const other = (await inject("POST", "/assets", admin, { name: "Line 4" })).json();

  const report = (
    await inject("POST", "/journal", author.cookie, {
      kind: "issue",
      title: "Conveyor jam on line 3",
      state: "submitted",
      // The person's own time on the job: 30 minutes.
      startedAt: "2026-07-15T09:30:00.000Z",
      endedAt: "2026-07-15T10:00:00.000Z",
      targets: [{ kind: "asset", id: line.id }],
    })
  ).json();

  return { author, line, other, report };
}

describe("downtime", () => {
  it("opens pending, closes by editing, and counts the span — not the report's work time", async () => {
    const admin = await superadmin();
    const { author, line, report } = await setup(admin);

    // The line went down at 09:00 — half an hour before anyone started working on it.
    const opened = await inject("POST", "/downtime", author.cookie, {
      reportId: report.id,
      targetKind: "asset",
      targetId: line.id,
      startedAt: "2026-07-15T09:00:00.000Z",
      reason: "Belt seized",
    });
    expect(opened.statusCode).toBe(201);
    const entry = opened.json();
    expect(entry.endedAt).toBeNull();
    expect(entry.durationMinutes).toBeNull();
    expect(entry.targetLabel).toBe("Line 3");

    // While open it sits in the pending queue.
    const pending = (await inject("GET", "/downtime/pending", author.cookie)).json();
    expect(pending.map((e: { id: string }) => e.id)).toEqual([entry.id]);

    // Close it by editing in the end time — the "pending entry, edited and saved" loop.
    const closed = await inject("PATCH", `/downtime/${entry.id}`, author.cookie, {
      endedAt: "2026-07-15T11:00:00.000Z",
    });
    expect(closed.statusCode).toBe(200);

    // Two hours down (09:00–11:00), which is not the 30 minutes the person spent.
    // Mixing those two up is the whole reason they are separate records.
    expect(closed.json().durationMinutes).toBe(120);
    expect(report.durationMinutes).toBe(30);

    // Closed, so it leaves the queue.
    expect((await inject("GET", "/downtime/pending", author.cookie)).json()).toEqual([]);
  });

  it("totals downtime per thing, and keeps a running outage counting", async () => {
    const admin = await superadmin();
    const { author, line, report } = await setup(admin);

    const raise = async (startedAt: string, endedAt?: string) =>
      (
        await inject("POST", "/downtime", author.cookie, {
          reportId: report.id,
          targetKind: "asset",
          targetId: line.id,
          startedAt,
          ...(endedAt ? { endedAt } : {}),
        })
      ).json();

    // Two closed outages on the same line: 60 + 30 minutes.
    await raise("2026-07-15T09:00:00.000Z", "2026-07-15T10:00:00.000Z");
    await raise("2026-07-15T14:00:00.000Z", "2026-07-15T14:30:00.000Z");

    let totals = (await inject("GET", "/downtime/totals", author.cookie)).json();
    expect(totals).toHaveLength(1);
    expect(totals[0].targetLabel).toBe("Line 3");
    expect(totals[0].totalMinutes).toBe(90);
    expect(totals[0].entryCount).toBe(2);
    expect(totals[0].openCount).toBe(0);

    // A third outage, still running, started an hour ago. An open breakdown must not
    // read as zero — it is counted up to now, so the total keeps climbing.
    const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    await raise(anHourAgo);

    totals = (await inject("GET", "/downtime/totals", author.cookie)).json();
    expect(totals[0].openCount).toBe(1);
    expect(totals[0].entryCount).toBe(3);
    expect(totals[0].totalMinutes).toBeGreaterThanOrEqual(149);
    expect(totals[0].totalMinutes).toBeLessThanOrEqual(151);
  });

  it("never totals a future-dated open outage as negative time", async () => {
    const admin = await superadmin();
    const { author, line, report } = await setup(admin);

    // A closed hour of real downtime...
    await inject("POST", "/downtime", author.cookie, {
      reportId: report.id,
      targetKind: "asset",
      targetId: line.id,
      startedAt: "2026-07-15T09:00:00.000Z",
      endedAt: "2026-07-15T10:00:00.000Z",
    });

    // ...and an open entry mistyped as starting an hour from now. Counted up to
    // "now" that span is negative, and a negative contribution would silently eat
    // the real hour beside it. Each span is floored at zero before it is summed.
    const inAnHour = new Date(Date.now() + 60 * 60_000).toISOString();
    await inject("POST", "/downtime", author.cookie, {
      reportId: report.id,
      targetKind: "asset",
      targetId: line.id,
      startedAt: inAnHour,
    });

    const totals = (await inject("GET", "/downtime/totals", author.cookie)).json();
    expect(totals[0].totalMinutes).toBe(60);
    expect(totals[0].openCount).toBe(1);
  });

  it("refuses downtime on something the report is not about, and a negative span", async () => {
    const admin = await superadmin();
    const { author, other, report } = await setup(admin);

    // Line 4 is not in this report's scope — the two must not drift apart.
    const wrongThing = await inject("POST", "/downtime", author.cookie, {
      reportId: report.id,
      targetKind: "asset",
      targetId: other.id,
      startedAt: "2026-07-15T09:00:00.000Z",
    });
    expect(wrongThing.statusCode).toBe(400);

    // Ending before starting is refused on the way in...
    const backwards = await inject("POST", "/downtime", author.cookie, {
      reportId: report.id,
      targetKind: "asset",
      targetId: (await inject("GET", `/journal/${report.id}`, author.cookie)).json().targets[0].id,
      startedAt: "2026-07-15T10:00:00.000Z",
      endedAt: "2026-07-15T09:00:00.000Z",
    });
    expect(backwards.statusCode).toBe(400);
  });

  it("refuses an edit that would close an entry before it started", async () => {
    const admin = await superadmin();
    const { author, line, report } = await setup(admin);

    const entry = (
      await inject("POST", "/downtime", author.cookie, {
        reportId: report.id,
        targetKind: "asset",
        targetId: line.id,
        startedAt: "2026-07-15T10:00:00.000Z",
      })
    ).json();

    // The check is against the merged record, since either side may be the one moving.
    const res = await inject("PATCH", `/downtime/${entry.id}`, author.cookie, {
      endedAt: "2026-07-15T09:00:00.000Z",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("which things carry downtime", () => {
  /**
   * Downtime means production stopped, so what can carry it is a fact about the
   * KIND of thing. A PC on an entry is something the work was about, not
   * something that halted a line — and offering to record its outage is how a
   * reliability figure ends up counting desk support.
   */
  it("says which targets record downtime, by their type", async () => {
    const admin = await superadmin();
    const dept = (await inject("POST", "/departments", admin, { name: "IT" })).json();

    // A production line, and a PC. The asset type ships tracking downtime; the
    // device type ships not tracking it.
    const lineType = (await inject("POST", "/asset-types", admin, { name: "Line 9000" })).json();
    const line = (
      await inject("POST", "/assets", admin, { name: "Line 9", typeId: lineType.id })
    ).json();
    const pcType = (
      await inject("POST", "/device-types", admin, { departmentId: dept.id, name: "Desktop" })
    ).json();
    const pc = (
      await inject("POST", "/devices", admin, { name: "Reception PC", typeId: pcType.id })
    ).json();

    const entry = (
      await inject("POST", "/journal", admin, {
        kind: "issue",
        title: "Line down while the PC was reimaged",
        state: "submitted",
        targets: [
          { kind: "asset", id: line.id },
          { kind: "device", id: pc.id },
        ],
      })
    ).json();

    const targets = (await inject("GET", `/journal/${entry.id}`, admin)).json().targets;
    const byLabel = Object.fromEntries(
      targets.map((t: { label: string; tracksDowntime: boolean }) => [t.label, t.tracksDowntime]),
    );
    expect(byLabel["Line 9"]).toBe(true);
    expect(byLabel["Reception PC"]).toBe(false);
  });

  it("lets a device type opt in, for the ones that do halt something", async () => {
    // A label printer on the line is a real case, and the point of putting the
    // switch on the type rather than hard-coding "devices never stop production".
    const admin = await superadmin();
    const dept = (await inject("POST", "/departments", admin, { name: "IT" })).json();
    const type = (
      await inject("POST", "/device-types", admin, {
        departmentId: dept.id,
        name: "Line label printer",
        tracksDowntime: true,
      })
    ).json();
    const printer = (
      await inject("POST", "/devices", admin, { name: "Labeller LP-1", typeId: type.id })
    ).json();

    const entry = (
      await inject("POST", "/journal", admin, {
        kind: "issue",
        title: "Labeller stopped the line",
        state: "submitted",
        targets: [{ kind: "device", id: printer.id }],
      })
    ).json();

    expect((await inject("GET", `/journal/${entry.id}`, admin)).json().targets[0]).toMatchObject({
      label: "Labeller LP-1",
      tracksDowntime: true,
    });
  });

  it("still offers downtime for something with no type at all", async () => {
    // Nobody has said either way, and refusing on a fact that was never recorded
    // loses an outage that did happen.
    const admin = await superadmin();
    const loose = (await inject("POST", "/assets", admin, { name: "Old compressor" })).json();
    const entry = (
      await inject("POST", "/journal", admin, {
        kind: "issue",
        title: "Compressor out",
        state: "submitted",
        targets: [{ kind: "asset", id: loose.id }],
      })
    ).json();

    expect((await inject("GET", `/journal/${entry.id}`, admin)).json().targets[0]).toMatchObject({
      label: "Old compressor",
      tracksDowntime: true,
    });
  });
});
