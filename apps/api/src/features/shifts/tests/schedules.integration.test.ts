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
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
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

  // A rota belongs to a department *at a site*, so the fixture names one. These
  // members cover no site in particular, which means all of them — so they are on
  // this site's rota like any other.
  const site = (await inject("GET", "/locations", admin)).json()[0];
  const dept = (await inject("POST", "/departments", admin, { name: "Ops" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [{ userId: inside.id, rank: "member", reportsToId: null }],
  });
  return { morning, evening, inside, outside, dept, site };
}

describe("schedules", () => {
  it("builds a month, then flags gaps and uncovered shifts until filled", async () => {
    const admin = await superadmin();
    const { morning, inside, dept, site } = await fixture(admin);

    const created = await inject("POST", "/schedules", admin, {
      departmentId: dept.id,
      locationId: site.id,
      year: 2026,
      month: 8,
    });
    expect(created.statusCode).toBe(201);
    const scheduleId = created.json().id;

    let grid = (
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
        admin,
      )
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
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
        admin,
      )
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
    const { morning, evening, inside, dept, site } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
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
    const { morning, inside, dept, site } = await fixture(admin);
    const aug = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
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
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
        admin,
      )
    ).json();
    const cell = augGrid.entries.find((e: { date: string }) => e.date === "2026-08-10");
    expect(cell.plannedShiftId).toBe(morning.id); // baseline frozen at publish

    // Carry August forward into September; the 10th's assignment comes with it.
    const sep = await inject("POST", "/schedules", admin, {
      departmentId: dept.id,
      locationId: site.id,
      year: 2026,
      month: 9,
      carryForwardFrom: { year: 2026, month: 8 },
    });
    expect(sep.statusCode).toBe(201);
    const sepGrid = (
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=9`,
        admin,
      )
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
    const { morning, evening, inside, dept, site } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
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
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
        admin,
      )
    ).json();
    const cell = grid.entries.find((e: { date: string }) => e.date === "2026-08-04");
    // Live is Evening, but the frozen baseline still reads Morning — so it shows as changed.
    expect(cell.shiftId).toBe(evening.id);
    expect(cell.plannedShiftId).toBe(morning.id);
  });

  it("logs post-publish edits to the change history, but not draft building", async () => {
    const admin = await superadmin();
    const { morning, evening, inside, dept, site } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
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
    const { morning, evening, inside, dept, site } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
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
    const { morning, inside, dept, site } = await fixture(admin);
    const scheduleId = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
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
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
        admin,
      )
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
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
        admin,
      )
    ).json();
    expect(grid.entries.filter((e: { date: string }) => dates.includes(e.date))).toHaveLength(0);
  });

  it("locks against edits, and only the HOD can unlock", async () => {
    const admin = await superadmin();
    const { morning, inside, dept, site } = await fixture(admin);
    // Add an HOD to the department (a plain Member by role, HOD by rank).
    const hod = await makeUser(admin, "hoduser", await makeGroup(admin, "Leads", "Member"));
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: inside.id, rank: "member", reportsToId: null },
        { userId: hod.id, rank: "hod", reportsToId: null },
      ],
    });
    const scheduleId = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
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
    const { inside, outside, dept, site } = await fixture(admin);
    await inject("POST", "/schedules", admin, {
      departmentId: dept.id,
      locationId: site.id,
      year: 2026,
      month: 8,
    });

    // Ravi is on the department → 200; Sam is not → 403.
    expect(
      (
        await inject(
          "GET",
          `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
          inside.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject(
          "GET",
          `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
          outside.cookie,
        )
      ).statusCode,
    ).toBe(403);
  });

  /* ------------------------- a rota belongs to a site ------------------------ */

  it("keeps two sites' rotas apart for the same department and month", async () => {
    const admin = await superadmin();
    const { morning, inside, dept, site } = await fixture(admin);
    const sites = (await inject("GET", "/locations", admin)).json();
    const other = sites.find((s: { id: string }) => s.id !== site.id);

    const here = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
    ).json();
    const there = await inject("POST", "/schedules", admin, {
      departmentId: dept.id,
      locationId: other.id,
      year: 2026,
      month: 8,
    });
    // Same department, same month, different site: two rotas, not a duplicate.
    expect(there.statusCode).toBe(201);
    expect(there.json().id).not.toBe(here.id);

    // A second rota for a site that already has one is still refused.
    expect(
      (
        await inject("POST", "/schedules", admin, {
          departmentId: dept.id,
          locationId: site.id,
          year: 2026,
          month: 8,
        })
      ).statusCode,
    ).toBe(409);

    // A cell on one is not on the other.
    await inject("POST", `/schedules/${here.id}/assign`, admin, {
      date: "2026-08-03",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });
    const otherGrid = (
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${other.id}&year=2026&month=8`,
        admin,
      )
    ).json();
    expect(otherGrid.entries).toHaveLength(0);
  });

  it("refuses a rota that does not say which site it is for", async () => {
    const admin = await superadmin();
    const { dept } = await fixture(admin);
    const res = await inject("POST", "/schedules", admin, {
      departmentId: dept.id,
      year: 2026,
      month: 8,
    });
    // "No site" would quietly mean the central rota, which holds none of the
    // department's staff — so it has to be said out loud.
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/choose a site/i);
  });

  /* ---------------------------- travelling staff ----------------------------- */

  it("puts central staff on the central rota and nowhere else", async () => {
    const admin = await superadmin();
    const { morning, inside, dept, site } = await fixture(admin);
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [{ userId: inside.id, rank: "member", reportsToId: null, isCentral: true }],
    });

    // The site's rota no longer offers them...
    const siteRota = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
    ).json();
    const siteGrid = (
      await inject(
        "GET",
        `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=8`,
        admin,
      )
    ).json();
    expect(siteGrid.members.map((m: { userId: string }) => m.userId)).not.toContain(inside.id);

    // ...and refuses to roster them there, which is the double-booking the separate
    // rota exists to prevent.
    const refused = await inject("POST", `/schedules/${siteRota.id}/assign`, admin, {
      date: "2026-08-04",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toMatch(/central/i);

    // The central rota is where they belong, and a day there can name the sites it
    // involved — one plant or two, with no hours attached.
    const central = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        central: true,
        year: 2026,
        month: 8,
      })
    ).json();
    const centralGrid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    expect(centralGrid.members.map((m: { userId: string }) => m.userId)).toEqual([inside.id]);
    expect(centralGrid.locationOptions.length).toBeGreaterThan(0);

    const sites = (await inject("GET", "/locations", admin)).json();
    const assigned = await inject("POST", `/schedules/${central.id}/assign`, admin, {
      date: "2026-08-04",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
      locationIds: [sites[0].id, sites[1].id],
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().locationIds).toHaveLength(2);

    const fresh = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    expect(fresh.entries[0].locationIds).toHaveLength(2);
  });

  it("refuses to tag a site rota's cell with sites of its own", async () => {
    const admin = await superadmin();
    const { morning, inside, dept, site } = await fixture(admin);
    const rota = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 8,
      })
    ).json();
    const res = await inject("POST", `/schedules/${rota.id}/assign`, admin, {
      date: "2026-08-05",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
      locationIds: [site.id],
    });
    // The rota's site is the answer; repeating it per cell is a second place for it
    // to be wrong.
    expect(res.statusCode).toBe(400);
  });

  it("keeps a rota that predates sites readable — its people stay on it", async () => {
    const admin = await superadmin();
    const { morning, inside, dept } = await fixture(admin);
    // A central rota with a cell for somebody who is *not* central: exactly what the
    // migration leaves behind, since every rota built before sites lands there.
    const central = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        central: true,
        year: 2026,
        month: 8,
      })
    ).json();
    await inject("POST", `/schedules/${central.id}/assign`, admin, {
      date: "2026-08-06",
      userId: inside.id,
      shiftId: morning.id,
      state: "working",
    });

    const grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    // Rostered, so they are shown — a month of published shifts must not vanish
    // because the rule about where they belong now says otherwise.
    expect(grid.members.map((m: { userId: string }) => m.userId)).toContain(inside.id);
    expect(grid.entries).toHaveLength(1);
  });
});

describe("deleting a rota", () => {
  it("takes the month and every shift in it, for a superadmin", async () => {
    // Reported from use: "there is no way to delete a schedule once created."
    const admin = await superadmin();
    const { dept, site, morning, inside } = await fixture(admin);

    const schedule = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 9,
      })
    ).json();
    await inject("POST", `/schedules/${schedule.id}/assign`, admin, {
      userId: inside.id,
      date: "2026-09-01",
      shiftId: morning.id,
    });

    expect((await inject("DELETE", `/schedules/${schedule.id}`, admin)).statusCode).toBe(204);

    // Gone, and its cells with it — the entries cascade rather than being orphaned.
    const after = await inject(
      "GET",
      `/schedules?departmentId=${dept.id}&locationId=${site.id}&year=2026&month=9`,
      admin,
    );
    expect(after.json().schedule).toBeNull();
  });

  it("is refused to a scheduler, who may build one but not destroy it", async () => {
    // His instruction: deletion is a superadmin's. Building a rota and erasing a
    // published one are different acts, and the second takes a month of planning.
    const admin = await superadmin();
    const { dept, site } = await fixture(admin);
    const schedulerGroup = await makeGroup(admin, "Planners", "Shifts admin");
    const scheduler = await makeUser(admin, "asha", schedulerGroup);

    const schedule = (
      await inject("POST", "/schedules", admin, {
        departmentId: dept.id,
        locationId: site.id,
        year: 2026,
        month: 9,
      })
    ).json();

    expect((await inject("DELETE", `/schedules/${schedule.id}`, scheduler.cookie)).statusCode).toBe(
      403,
    );
  });

  it("lets a scheduler see the sites they roster", async () => {
    // The production report: a user in two sites "is being shown central schedule
    // but he is not in central... he has no option to select those in menu". The
    // site picker reads GET /locations, and "Shifts admin" lacked locations:read —
    // so it came back empty and the page fell back to the central rota, which is a
    // real rota for the wrong people.
    const admin = await superadmin();
    const schedulerGroup = await makeGroup(admin, "Planners", "Shifts admin");
    const scheduler = await makeUser(admin, "asha", schedulerGroup);

    const sites = await inject("GET", "/locations", scheduler.cookie);
    expect(sites.statusCode).toBe(200);
    expect((sites.json() as unknown[]).length).toBeGreaterThan(0);
  });
});
