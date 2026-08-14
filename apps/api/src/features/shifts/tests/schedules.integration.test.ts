// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for the per-department schedule calendar: building a month,
// coverage/gap flags, the overlap guard (with a legitimate double allowed), publish
// freezing the baseline, carry-forward, and the department-membership read scope.
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
    headers: { cookie, "x-company-id": DEMO_COMPANY_ID },
    payload: payload as object,
  });
}

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

async function makeUser(
  admin: string,
  username: string,
  groupId: string,
): Promise<{ id: string; cookie: string }> {
  const created = await inject("POST", "/users", admin, {
    name: username,
    email: `${username}@reportly.test`,
    username,
    password: TEMP_PW,
  });
  const id = created.json().id as string;
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

/** A department with one member on it, plus Morning/Evening/Night shifts. */
async function fixture(admin: string) {
  const morning = (
    await inject("POST", "/shifts", admin, {
      name: "Morning",
      code: "M",
      startMinute: 360,
      endMinute: 840,
    })
  ).json();
  const evening = (
    await inject("POST", "/shifts", admin, {
      name: "Evening",
      code: "E",
      startMinute: 840,
      endMinute: 1320,
    })
  ).json();
  const memberGroup = await makeGroup(admin, "Floor", "Member");
  const inside = await makeUser(admin, "ravi", memberGroup);
  const outside = await makeUser(admin, "sam", memberGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Ops" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [{ userId: inside.id, rank: "member", reportsToId: null }],
  });
  return { morning, evening, inside, outside, dept };
}

describe("schedules", () => {
  it("builds a month, then flags gaps and uncovered shifts until filled", async () => {
    const admin = await superadmin();
    const { morning, inside, dept } = await fixture(admin);

    const created = await inject("POST", "/schedules", admin, {
      departmentId: dept.id,
      year: 2026,
      month: 8,
    });
    expect(created.statusCode).toBe(201);
    const scheduleId = created.json().id;

    let grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    expect(grid.days).toHaveLength(31);
    expect(grid.members.map((m: { userId: string }) => m.userId)).toEqual([inside.id]);
    // Nothing assigned yet: the member is a gap on day 1, and Morning is uncovered.
    expect(grid.coverage.gaps.some((g: { date: string }) => g.date === "2026-08-01")).toBe(true);
    expect(
      grid.coverage.uncovered.some(
        (u: { date: string; shiftId: string }) =>
          u.date === "2026-08-01" && u.shiftId === morning.id,
      ),
    ).toBe(true);

    // Put the member on Morning for the 1st.
    const assigned = await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: "2026-08-01",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });
    expect(assigned.statusCode).toBe(200);

    grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    expect(grid.coverage.gaps.some((g: { date: string }) => g.date === "2026-08-01")).toBe(false);
    expect(
      grid.coverage.uncovered.some(
        (u: { date: string; shiftId: string }) =>
          u.date === "2026-08-01" && u.shiftId === morning.id,
      ),
    ).toBe(false);
  });

  it("refuses an overlapping shift but allows a non-overlapping double", async () => {
    const admin = await superadmin();
    const { morning, evening, inside, dept } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 })
    ).json().id;

    await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: "2026-08-02",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });

    // A second Morning the same day overlaps the first → refused.
    const clash = await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: "2026-08-02",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });
    expect(clash.statusCode).toBe(409);

    // Evening (14:00–22:00) does not overlap Morning (06:00–14:00) → a legit double.
    const double = await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: "2026-08-02",
      userId: inside.id,
      shiftId: evening.id,
      state: "working",
    });
    expect(double.statusCode).toBe(200);
  });

  it("publishing freezes the baseline; carry-forward copies the roster on", async () => {
    const admin = await superadmin();
    const { morning, inside, dept } = await fixture(admin);
    const aug = (
      await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 })
    ).json();
    await inject("POST", `/schedules/${aug.id}/assign`, admin, {
      date: "2026-08-10",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });

    const published = await inject("POST", `/schedules/${aug.id}/publish`, admin);
    expect(published.json().status).toBe("published");
    const augGrid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    const cell = augGrid.entries.find((e: { date: string }) => e.date === "2026-08-10");
    expect(cell.plannedShiftId).toBe(morning.id); // baseline frozen at publish

    // Carry August forward into September; the 10th's assignment comes with it.
    const sep = await inject("POST", "/schedules", admin, {
      departmentId: dept.id,
      year: 2026,
      month: 9,
      carryForwardFrom: { year: 2026, month: 8 },
    });
    expect(sep.statusCode).toBe(201);
    const sepGrid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=9`, admin)
    ).json();
    expect(
      sepGrid.entries.some(
        (e: { date: string; shiftId: string }) =>
          e.date === "2026-09-10" && e.shiftId === morning.id,
      ),
    ).toBe(true);
  });

  it("keeps the baseline when the brush edits a cell after publishing, so the change shows", async () => {
    const admin = await superadmin();
    const { morning, evening, inside, dept } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 })
    ).json().id;
    await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: "2026-08-04",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });
    await inject("POST", `/schedules/${scheduleId}/publish`, admin);

    // After publishing, the scheduler brushes the day to Evening.
    await inject("POST", `/schedules/${scheduleId}/assign-bulk`, admin, {
      userId: inside.id,
      dates: ["2026-08-04"],
      set: { shiftId: evening.id, state: "working" },
    });

    const grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    const cell = grid.entries.find((e: { date: string }) => e.date === "2026-08-04");
    // Live is Evening, but the frozen baseline still reads Morning — so it shows as changed.
    expect(cell.shiftId).toBe(evening.id);
    expect(cell.plannedShiftId).toBe(morning.id);
  });

  it("logs post-publish edits to the change history, but not draft building", async () => {
    const admin = await superadmin();
    const { morning, evening, inside, dept } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 })
    ).json().id;

    const runChanges = async () =>
      (
        await inject("POST", "/reports/run", admin, {
          definition: {
            source: "shift_changes",
            departmentId: dept.id,
            range: "custom",
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-31T00:00:00.000Z",
            grouping: "none",
            columns: ["date"],
            filters: {},
          },
        })
      )
        .json()
        .groups.flatMap((g: { rows: { cells: Record<string, string> }[] }) => g.rows);

    // A draft assignment logs nothing.
    await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: "2026-08-04",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });
    expect(await runChanges()).toHaveLength(0);

    // After publishing, a brush edit is logged from→to.
    await inject("POST", `/schedules/${scheduleId}/publish`, admin);
    await inject("POST", `/schedules/${scheduleId}/assign-bulk`, admin, {
      userId: inside.id,
      dates: ["2026-08-04"],
      set: { shiftId: evening.id, state: "working" },
    });
    const rows = await runChanges();
    expect(
      rows.some((r: { cells: Record<string, string> }) =>
        /Morning.*→.*Evening/.test(r.cells.change),
      ),
    ).toBe(true);
  });

  it("reports the roster, coverage, and attendance for a department", async () => {
    const admin = await superadmin();
    const { morning, evening, inside, dept } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 })
    ).json().id;
    const assign = (date: string, shiftId: string | null, state = "working") =>
      inject("POST", `/schedules/${scheduleId}/assign`, admin, {
        date,
        userId: inside.id,
        shiftId,
        state,
      });
    await assign("2026-08-04", morning.id);
    await assign("2026-08-05", null, "off");
    await assign("2026-08-06", morning.id);
    await assign("2026-08-06", evening.id); // a non-overlapping double

    const run = (source: string) =>
      inject("POST", "/reports/run", admin, {
        definition: {
          source,
          departmentId: dept.id,
          range: "custom",
          from: "2026-08-01T00:00:00.000Z",
          to: "2026-08-31T00:00:00.000Z",
          grouping: "none",
          columns: ["date"],
          filters: {},
        },
      });
    const rowsOf = (res: {
      json: () => { groups: { rows: { cells: Record<string, string> }[] }[] };
    }) => res.json().groups.flatMap((g) => g.rows);

    // Roster: one row per working assignment (the off is not one) → 3.
    expect(rowsOf(await run("shift_roster"))).toHaveLength(3);

    // Coverage: Evening on the 4th has nobody.
    const cov = rowsOf(await run("shift_coverage"));
    const aug4evening = cov.find(
      (r) => r.cells.date === "04-08-2026" && r.cells.shift === "Evening",
    );
    expect(aug4evening?.cells.status).toBe("Uncovered");

    // Attendance: 3 working entries, 1 off, and one double (the 6th).
    const att = rowsOf(await run("shift_attendance"));
    const ravi = att.find((r) => r.cells.person === "ravi");
    expect(ravi).toMatchObject({
      cells: expect.objectContaining({ working: "3", off: "1", doubles: "1" }),
    });
  });

  it("sets many days at once with the bulk brush, and clears them", async () => {
    const admin = await superadmin();
    const { morning, inside, dept } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 })
    ).json().id;

    const dates = ["2026-08-05", "2026-08-06", "2026-08-07"];
    const set = await inject("POST", `/schedules/${scheduleId}/assign-bulk`, admin, {
      userId: inside.id,
      dates,
      set: { shiftId: morning.id, state: "working" },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().count).toBe(3);

    let grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    const onMorning = grid.entries.filter(
      (e: { date: string; shiftId: string }) => dates.includes(e.date) && e.shiftId === morning.id,
    );
    expect(onMorning).toHaveLength(3);

    // Clearing those days with set: null removes the entries.
    await inject("POST", `/schedules/${scheduleId}/assign-bulk`, admin, {
      userId: inside.id,
      dates,
      set: null,
    });
    grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    expect(grid.entries.filter((e: { date: string }) => dates.includes(e.date))).toHaveLength(0);
  });

  it("locks against edits, and only the HOD can unlock", async () => {
    const admin = await superadmin();
    const { morning, inside, dept } = await fixture(admin);
    // Add an HOD to the department (a plain Member by role, HOD by rank).
    const hod = await makeUser(admin, "hoduser", await makeGroup(admin, "Leads", "Member"));
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: inside.id, rank: "member", reportsToId: null },
        { userId: hod.id, rank: "hod", reportsToId: null },
      ],
    });
    const scheduleId = (
      await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 })
    ).json().id;

    const locked = await inject("POST", `/schedules/${scheduleId}/lock`, admin);
    expect(locked.json().locked).toBe(true);

    // Direct edits are refused while locked.
    const blocked = await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: "2026-08-01",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });
    expect(blocked.statusCode).toBe(409);

    // A member who is not the HOD cannot unlock it.
    expect(
      (await inject("POST", `/schedules/${scheduleId}/unlock`, inside.cookie)).statusCode,
    ).toBe(403);

    // The HOD can — and then edits work again.
    expect((await inject("POST", `/schedules/${scheduleId}/unlock`, hod.cookie)).statusCode).toBe(
      200,
    );
    const after = await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: "2026-08-01",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });
    expect(after.statusCode).toBe(200);
  });

  it("reads only for a department member (or a scheduler)", async () => {
    const admin = await superadmin();
    const { inside, outside, dept } = await fixture(admin);
    await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 });

    // Ravi is on the department → 200; Sam is not → 403.
    expect(
      (await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, inside.cookie))
        .statusCode,
    ).toBe(200);
    expect(
      (await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, outside.cookie))
        .statusCode,
    ).toBe(403);
  });
});
