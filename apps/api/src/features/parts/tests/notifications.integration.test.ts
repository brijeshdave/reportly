// Author: Brijesh Dave <https://github.com/brijeshdave>
// Who the two cartridge notifications reach.
//
// Both make a claim the catalogue cannot check on its own. The reversal is aimed
// at one named person; the cycle-limit notice is aimed at "whoever may retire a
// part, here" — which is the `operators` audience WITHOUT `systemWide`, a
// combination this module is the first to use. If that combination silently meant
// "every administrator on the server", a company would be told about another
// company's cartridges, and nothing else would notice.
//
// `dispatch()` is called directly rather than through the queue: the worker runs
// in the server process, so a queued job would sit in Redis and a notification
// that never arrived would look exactly like one correctly suppressed.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { dispatch } from "@/features/notifications/service.js";
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

function inject(
  method: string,
  url: string,
  cookie: string,
  payload?: unknown,
  companyId?: string,
) {
  return app.inject({
    method: method as "GET",
    url: `${API_PREFIX}${url}`,
    headers: { cookie, "x-company-id": companyId ?? DEMO_COMPANY_ID },
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

async function makeGroup(admin: string, name: string, roleName: string): Promise<string> {
  const group = (await inject("POST", "/groups", admin, { name })).json();
  const roles = (await inject("GET", "/roles?pageSize=100", admin)).json().data;
  const role = roles.find((r: { name: string }) => r.name === roleName);
  await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });
  return group.id as string;
}

async function makeUser(
  admin: string,
  name: string,
  username: string,
  groupId: string,
  companyIds: string[] = [DEMO_COMPANY_ID],
): Promise<{ id: string; cookie: string }> {
  const id = (
    await inject("POST", "/users", admin, {
      name,
      email: `${username}@reportly.test`,
      username,
      password: TEMP_PW,
    })
  ).json().id as string;
  await inject("PUT", `/users/${id}/companies`, admin, { ids: companyIds });

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

/** Someone outside the demo company has to be asked in their own context. */
const unreadOf = async (cookie: string, companyId?: string) =>
  (await inject("GET", "/me/notifications/unread-count", cookie, undefined, companyId)).json()
    .unread;

/** A bench technician and the person who runs the module. */
async function buildWorkshop(admin: string) {
  const techGroup = await makeGroup(admin, "Bench", "Cartridge technician");
  const adminGroup = await makeGroup(admin, "Workshop leads", "Cartridge admin");
  return {
    tech: await makeUser(admin, "Asha Bench", "asha", techGroup),
    lead: await makeUser(admin, "Ken Workshop", "ken", adminGroup),
  };
}

describe("the reversal notice", () => {
  it("reaches the technician whose service was reversed, and nobody else", async () => {
    const admin = await superadmin();
    const { tech, lead } = await buildWorkshop(admin);

    // The lead booked the faulty part in; the technician who refilled it is the
    // one whose score just moved.
    await dispatch({
      type: "part.points-reversed",
      companyId: DEMO_COMPANY_ID,
      actorUserId: lead.id,
      userIds: [tech.id],
      title: "5 points taken back for TN-0042",
    });

    expect(await unreadOf(tech.cookie)).toBe(1);
    expect(await unreadOf(lead.cookie)).toBe(0);
  });

  it("says nothing when the technician booked the part in themselves", async () => {
    const admin = await superadmin();
    const { tech } = await buildWorkshop(admin);

    await dispatch({
      type: "part.points-reversed",
      companyId: DEMO_COMPANY_ID,
      actorUserId: tech.id,
      userIds: [tech.id],
      title: "5 points taken back for TN-0042",
    });

    // They pressed the button and the response told them so. A bell entry for
    // something you just did on screen is the noise that teaches people to stop
    // reading the bell.
    expect(await unreadOf(tech.cookie)).toBe(0);
  });
});

describe("the cycle-limit notice", () => {
  it("reaches whoever may retire a part, not whoever serviced it", async () => {
    const admin = await superadmin();
    const { tech, lead } = await buildWorkshop(admin);

    await dispatch({
      type: "part.over-cycle-limit",
      companyId: DEMO_COMPANY_ID,
      actorUserId: tech.id,
      title: "TN-0042 has passed its rated cycles",
    });

    // Scrapping is `parts:manage`, which the technician does not hold — and they
    // already saw the flag on the part in front of them.
    expect(await unreadOf(lead.cookie)).toBe(1);
    expect(await unreadOf(tech.cookie)).toBe(0);
  });

  it("stays inside the company whose cartridge it is", async () => {
    const admin = await superadmin();
    const { tech } = await buildWorkshop(admin);
    const other = (await inject("POST", "/companies", admin, { name: "Other Co" })).json();
    const outsideGroup = await makeGroup(admin, "Their workshop", "Cartridge admin");
    const outsider = await makeUser(admin, "Nina Outside", "nina", outsideGroup, [other.id]);

    await dispatch({
      type: "part.over-cycle-limit",
      companyId: DEMO_COMPANY_ID,
      actorUserId: tech.id,
      title: "TN-0042 has passed its rated cycles",
    });

    // `operators` resolves holders across the whole installation — that is what it
    // is for, and it is right for a failing backup, which belongs to the server.
    // A cartridge belongs to a tenant, so leaving `systemWide` off is what puts
    // the company gate back in front of the audience. This is the assertion that
    // that is really so, rather than merely intended.
    expect(await unreadOf(outsider.cookie, other.id)).toBe(0);
  });
});
