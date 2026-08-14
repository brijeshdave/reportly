// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integration tests for colleague-swap requests: raising one against your own shift
// and a coworker's, the reporting-manager routing (a plain team lead with no
// scheduler permission can still decide their reports' swaps), and the exchange that
// approval performs on the calendar.
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

async function makeUser(admin: string, username: string, groupId: string) {
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

const DAY = "2026-08-03";

/** A team lead with two reports, a published month, and the two put on different shifts. */
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
  // The boss is a plain Member — a team lead by reporting line, not a scheduler.
  const boss = await makeUser(admin, "boss", memberGroup);
  const ravi = await makeUser(admin, "ravi", memberGroup);
  const sam = await makeUser(admin, "sam", memberGroup);

  const dept = (await inject("POST", "/departments", admin, { name: "Ops" })).json();
  await inject("PUT", `/departments/${dept.id}/members`, admin, {
    members: [
      { userId: boss.id, rank: "lead", reportsToId: null },
      { userId: ravi.id, rank: "member", reportsToId: boss.id },
      { userId: sam.id, rank: "member", reportsToId: boss.id },
    ],
  });

  const schedule = (
    await inject("POST", "/schedules", admin, { departmentId: dept.id, year: 2026, month: 8 })
  ).json();
  await inject("POST", `/schedules/${schedule.id}/assign`, admin, {
    date: DAY,
    userId: ravi.id,
    shiftId: morning.id,
    state: "working",
  });
  await inject("POST", `/schedules/${schedule.id}/assign`, admin, {
    date: DAY,
    userId: sam.id,
    shiftId: evening.id,
    state: "working",
  });
  await inject("POST", `/schedules/${schedule.id}/publish`, admin);

  return { morning, evening, boss, ravi, sam, dept, scheduleId: schedule.id };
}

async function entryId(cookie: string, dept: string, userId: string): Promise<string> {
  const grid = (
    await inject("GET", `/schedules?departmentId=${dept}&year=2026&month=8`, cookie)
  ).json();
  return grid.entries.find(
    (e: { userId: string; date: string }) => e.userId === userId && e.date === DAY,
  ).id;
}

describe("shift swaps", () => {
  it("a report requests, the reporting manager approves, and the shifts trade", async () => {
    const admin = await superadmin();
    const { morning, evening, boss, ravi, sam, dept, scheduleId } = await fixture(admin);

    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);
    const samEntry = await entryId(ravi.cookie, dept.id, sam.id);

    const request = await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
      counterpartEntryId: samEntry,
      note: "Doctor's appointment",
    });
    expect(request.statusCode).toBe(201);

    // The boss (their reporting manager, not a scheduler) sees it and may decide it.
    const inbox = (await inject("GET", "/swaps?box=inbox", boss.cookie)).json();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      requesterName: "ravi",
      counterpartName: "sam",
      canDecide: true,
    });

    // Sam (the counterpart, no reports) has an empty inbox and cannot decide it.
    expect((await inject("GET", "/swaps?box=inbox", sam.cookie)).json()).toHaveLength(0);
    const samDecision = await inject("POST", `/swaps/${inbox[0].id}/decision`, sam.cookie, {
      decision: "approve",
    });
    expect(samDecision.statusCode).toBe(403);

    // The boss approves — the two entries exchange shifts.
    const approved = await inject("POST", `/swaps/${inbox[0].id}/decision`, boss.cookie, {
      decision: "approve",
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("approved");

    const grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    const raviCell = grid.entries.find(
      (e: { userId: string; date: string }) => e.userId === ravi.id && e.date === DAY,
    );
    const samCell = grid.entries.find(
      (e: { userId: string; date: string }) => e.userId === sam.id && e.date === DAY,
    );
    // Ravi now works Evening, Sam now works Morning — while the frozen baseline holds.
    expect(raviCell.shiftId).toBe(evening.id);
    expect(raviCell.plannedShiftId).toBe(morning.id);
    expect(samCell.shiftId).toBe(morning.id);
    expect(samCell.plannedShiftId).toBe(evening.id);
  });

  it("takes a request with no suggestion; the manager picks who and approves", async () => {
    const admin = await superadmin();
    const { morning, evening, boss, ravi, sam, dept, scheduleId } = await fixture(admin);
    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);
    const samEntry = await entryId(ravi.cookie, dept.id, sam.id);

    // Ravi asks to change their shift without naming anyone.
    const request = await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
      note: "Any swap works",
    });
    expect(request.statusCode).toBe(201);

    // The pending change shows on the calendar grid.
    const grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    expect(
      grid.pendingChanges.some(
        (p: { requesterEntryId: string }) => p.requesterEntryId === raviEntry,
      ),
    ).toBe(true);

    // The boss sees candidates (Sam among them) and approves picking Sam.
    const inbox = (await inject("GET", "/swaps?box=inbox", boss.cookie)).json();
    expect(inbox[0].counterpartEntryId).toBeNull();
    expect(inbox[0].candidates.some((c: { entryId: string }) => c.entryId === samEntry)).toBe(true);

    const approved = await inject("POST", `/swaps/${inbox[0].id}/decision`, boss.cookie, {
      decision: "approve",
      counterpartEntryId: samEntry,
    });
    expect(approved.statusCode).toBe(200);

    const after = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    const raviCell = after.entries.find((e: { userId: string }) => e.userId === ravi.id);
    const samCell = after.entries.find((e: { userId: string }) => e.userId === sam.id);
    // The two traded: Ravi now works Evening, Sam Morning.
    expect(raviCell.shiftId).toBe(evening.id);
    expect(samCell.shiftId).toBe(morning.id);
  });

  it("refuses to approve with no counterpart chosen", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept, scheduleId } = await fixture(admin);
    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);
    await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
    });
    const inbox = (await inject("GET", "/swaps?box=inbox", boss.cookie)).json();
    // Approving without picking a colleague is refused.
    expect(
      (await inject("POST", `/swaps/${inbox[0].id}/decision`, boss.cookie, { decision: "approve" }))
        .statusCode,
    ).toBe(400);
  });

  it("keeps a decided request in the approver's handled box", async () => {
    const admin = await superadmin();
    const { boss, ravi, sam, dept, scheduleId } = await fixture(admin);
    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);
    const samEntry = await entryId(ravi.cookie, dept.id, sam.id);
    await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
      counterpartEntryId: samEntry,
    });
    const inbox = (await inject("GET", "/swaps?box=inbox", boss.cookie)).json();
    await inject("POST", `/swaps/${inbox[0].id}/decision`, boss.cookie, { decision: "approve" });

    // Gone from the inbox…
    expect((await inject("GET", "/swaps?box=inbox", boss.cookie)).json()).toHaveLength(0);
    // …but kept in the boss's handled record, naming them as the approver.
    const handled = (await inject("GET", "/swaps?box=handled", boss.cookie)).json();
    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({
      status: "approved",
      approverName: "boss",
      counterpartName: "sam",
    });
  });

  it("refuses a duplicate pending request and lets the requester withdraw", async () => {
    const admin = await superadmin();
    const { ravi, dept, scheduleId } = await fixture(admin);
    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);

    const first = await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
    });
    expect(first.statusCode).toBe(201);
    // A second request for the same shift is refused while the first is pending.
    expect(
      (
        await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
          requesterEntryId: raviEntry,
        })
      ).statusCode,
    ).toBe(409);

    // The requester can withdraw it, and then request again.
    expect(
      (await inject("POST", `/swaps/${first.json().id}/cancel`, ravi.cookie)).json().status,
    ).toBe("cancelled");
    expect(
      (
        await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
          requesterEntryId: raviEntry,
        })
      ).statusCode,
    ).toBe(201);
  });

  it("approves with no swap, taking the requester off the shift", async () => {
    const admin = await superadmin();
    const { boss, ravi, dept, scheduleId } = await fixture(admin);
    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);
    await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
    });
    const inbox = (await inject("GET", "/swaps?box=inbox", boss.cookie)).json();

    const approved = await inject("POST", `/swaps/${inbox[0].id}/decision`, boss.cookie, {
      decision: "approve",
      noSwap: true,
    });
    expect(approved.statusCode).toBe(200);

    const grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    // Ravi is taken off — the cell is removed entirely (empty/unassigned, a gap), not W/O.
    expect(
      grid.entries.some(
        (e: { userId: string; date: string }) => e.userId === ravi.id && e.date === DAY,
      ),
    ).toBe(false);
    expect(
      grid.coverage.gaps.some(
        (g: { userId: string; date: string }) => g.userId === ravi.id && g.date === DAY,
      ),
    ).toBe(true);
    // The decided request survives as the approver's record.
    expect((await inject("GET", "/swaps?box=handled", boss.cookie)).json()).toHaveLength(1);
  });

  it("never offers the Head of Department as a swap candidate", async () => {
    const admin = await superadmin();
    const { morning, boss, ravi, sam, dept, scheduleId } = await fixture(admin);
    // Make the boss the HOD and put them on a shift that day.
    await inject("PUT", `/departments/${dept.id}/members`, admin, {
      members: [
        { userId: boss.id, rank: "hod", reportsToId: null },
        { userId: ravi.id, rank: "member", reportsToId: boss.id },
        { userId: sam.id, rank: "member", reportsToId: boss.id },
      ],
    });
    await inject("POST", `/schedules/${scheduleId}/assign`, admin, {
      date: DAY,
      userId: boss.id,
      shiftId: morning.id,
      state: "working",
    });

    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);
    await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
    });
    const inbox = (await inject("GET", "/swaps?box=inbox", boss.cookie)).json();
    const names = inbox[0].candidates.map((c: { name: string }) => c.name);
    expect(names).toContain("sam");
    expect(names).not.toContain("boss");
  });

  it("lets a person on a weekly off request a change and swap into a shift", async () => {
    const admin = await superadmin();
    const { evening, boss, ravi, sam, dept, scheduleId } = await fixture(admin);
    // Put Ravi on a weekly off that day (overwriting the fixture's Morning).
    await inject("POST", `/schedules/${scheduleId}/assign-bulk`, admin, {
      userId: ravi.id,
      dates: [DAY],
      set: { shiftId: null, state: "off" },
    });
    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);

    // Ravi (on W/O) asks to change it and swap into Sam's shift.
    const req = await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
    });
    expect(req.statusCode).toBe(201);

    const inbox = (await inject("GET", "/swaps?box=inbox", boss.cookie)).json();
    const samCand = inbox[0].candidates.find((c: { name: string }) => c.name === "sam");
    await inject("POST", `/swaps/${inbox[0].id}/decision`, boss.cookie, {
      decision: "approve",
      counterpartEntryId: samCand.entryId,
    });

    const grid = (
      await inject("GET", `/schedules?departmentId=${dept.id}&year=2026&month=8`, admin)
    ).json();
    const raviCell = grid.entries.find((e: { userId: string }) => e.userId === ravi.id);
    const samCell = grid.entries.find((e: { userId: string }) => e.userId === sam.id);
    // Ravi now works Evening (Sam's shift); Sam takes the weekly off.
    expect(raviCell.shiftId).toBe(evening.id);
    expect(raviCell.state).toBe("working");
    expect(samCell.state).toBe("off");
    expect(samCell.shiftId).toBeNull();
  });

  it("logs an approved swap so the shift-change report shows it", async () => {
    const admin = await superadmin();
    const { boss, ravi, sam, dept, scheduleId } = await fixture(admin);
    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);
    const samEntry = await entryId(ravi.cookie, dept.id, sam.id);
    await inject("POST", `/schedules/${scheduleId}/swaps`, ravi.cookie, {
      requesterEntryId: raviEntry,
      counterpartEntryId: samEntry,
    });
    const inbox = (await inject("GET", "/swaps?box=inbox", boss.cookie)).json();
    await inject("POST", `/swaps/${inbox[0].id}/decision`, boss.cookie, { decision: "approve" });

    const res = await inject("POST", "/reports/run", admin, {
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
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.source).toBe("shift_changes");
    const rows = res
      .json()
      .groups.flatMap((g: { rows: { cells: Record<string, string> }[] }) => g.rows);
    const raviRow = rows.find((r: { cells: Record<string, string> }) => r.cells.person === "ravi");
    expect(raviRow.cells.change).toMatch(/Morning.*→.*Evening/);
    expect(raviRow.cells.action).toBe("swap");
    expect(raviRow.cells.actor).toBe("boss");
  });

  it("refuses to swap a shift you do not own", async () => {
    const admin = await superadmin();
    const { ravi, sam, dept, scheduleId } = await fixture(admin);
    const raviEntry = await entryId(ravi.cookie, dept.id, ravi.id);
    const samEntry = await entryId(ravi.cookie, dept.id, sam.id);

    // Sam tries to offer Ravi's shift as if it were their own to give.
    const bad = await inject("POST", `/schedules/${scheduleId}/swaps`, sam.cookie, {
      requesterEntryId: raviEntry,
      counterpartEntryId: samEntry,
    });
    expect(bad.statusCode).toBe(403);
  });
});
