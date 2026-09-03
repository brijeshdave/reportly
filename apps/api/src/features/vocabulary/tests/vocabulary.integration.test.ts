// Author: Brijesh Dave <https://github.com/brijeshdave>
// Device types and tags — a department's own vocabulary.
//
// What has to be exactly right here:
//   - the same name in two departments is fine; twice in one is a 409
//   - the granular permissions are separable, which is the whole point of
//     splitting them out of report-config:manage — a group can hold one and not
//     the others
//   - a catalogue row in use is retired, never deleted
//   - tags are validated against the record's OWN department, so a tag cannot be
//     borrowed from another one
//   - a new tag gets a colour without being asked, and a custom colour is kept
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { API_PREFIX, buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { resetDb } from "../../../../test/reset-db.js";
import { anySeverityId } from "../../../../test/seeded.js";

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

/** Two departments, so the per-department rules can actually be tested. */
async function twoDepartments(admin: string) {
  const list = (await inject("GET", "/departments", admin)).json();
  const engineering = list.find((d: { name: string }) => d.name === "Engineering");
  const sales = list.find((d: { name: string }) => d.name === "Sales");
  return { engineering, sales };
}

describe("device types", () => {
  it("allows the same name in two departments but not twice in one", async () => {
    const admin = await superadmin();
    const { engineering, sales } = await twoDepartments(admin);

    const first = await inject("POST", "/device-types", admin, {
      departmentId: engineering.id,
      name: "Pump",
      description: "Anything that moves fluid",
    });
    expect(first.statusCode).toBe(201);

    // The same word, a different department's meaning of it.
    const elsewhere = await inject("POST", "/device-types", admin, {
      departmentId: sales.id,
      name: "Pump",
    });
    expect(elsewhere.statusCode).toBe(201);

    const duplicate = await inject("POST", "/device-types", admin, {
      departmentId: engineering.id,
      name: "Pump",
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("retires a type that devices hold rather than deleting it", async () => {
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);

    const type = (
      await inject("POST", "/device-types", admin, { departmentId: engineering.id, name: "Valve" })
    ).json();
    await inject("POST", "/devices", admin, { name: "Valve 7", typeId: type.id });

    // Deleting would set-null the type off the device, quietly un-labelling it.
    const refused = await inject("DELETE", `/device-types/${type.id}`, admin);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.details.deviceCount).toBe(1);

    // Retiring is the supported path: gone from the picker, kept on the device.
    const retired = await inject("PATCH", `/device-types/${type.id}`, admin, {
      status: "inactive",
    });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().status).toBe("inactive");
  });
});

describe("tags", () => {
  it("gives a new tag a colour without being asked, and keeps a custom one", async () => {
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);

    const auto = (
      await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "safety" })
    ).json();
    expect(auto.color).toMatch(/^#[0-9a-f]{6}$/i);

    const custom = (
      await inject("POST", "/tags", admin, {
        departmentId: engineering.id,
        name: "urgent",
        color: "#123abc",
      })
    ).json();
    expect(custom.color).toBe("#123abc");

    // Colours are drawn from the unused ones first, so two fresh tags in the same
    // department do not collide.
    const second = (
      await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "electrical" })
    ).json();
    expect(second.color).not.toBe(auto.color);

    const rejected = await inject("POST", "/tags", admin, {
      departmentId: engineering.id,
      name: "bad",
      color: "not-a-colour",
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("attaches several tags to a report and replaces them only when asked", async () => {
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);

    const safety = (
      await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "safety" })
    ).json();
    const leak = (
      await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "leak" })
    ).json();

    const report = (
      await inject("POST", "/journal", admin, {
        kind: "issue",
        severityId: await anySeverityId(),
        title: "Coolant on the floor",
        state: "submitted",
        issueSummary: "Puddle",
        departmentId: engineering.id,
        tagIds: [safety.id, leak.id],
      })
    ).json();
    expect(report.tags.map((t: { name: string }) => t.name).sort()).toEqual(["leak", "safety"]);
    // The colour rides along, so a chip can be rendered without a second call.
    expect(report.tags[0].color).toMatch(/^#[0-9a-f]{6}$/i);

    // An edit that never mentions tags must not drop them.
    await inject("PATCH", `/journal/${report.id}`, admin, { title: "Coolant on the floor (am)" });
    const untouched = (await inject("GET", `/journal/${report.id}`, admin)).json();
    expect(untouched.tags).toHaveLength(2);

    // Sending the key replaces the set; sending [] clears it.
    await inject("PATCH", `/journal/${report.id}`, admin, { tagIds: [safety.id] });
    expect((await inject("GET", `/journal/${report.id}`, admin)).json().tags).toHaveLength(1);
    await inject("PATCH", `/journal/${report.id}`, admin, { tagIds: [] });
    expect((await inject("GET", `/journal/${report.id}`, admin)).json().tags).toHaveLength(0);
  });

  it("filters the report list to a tag", async () => {
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);

    const safety = (
      await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "safety" })
    ).json();

    const tagged = (
      await inject("POST", "/journal", admin, {
        kind: "issue",
        severityId: await anySeverityId(),
        title: "Guard missing",
        state: "submitted",
        issueSummary: "No guard",
        departmentId: engineering.id,
        tagIds: [safety.id],
      })
    ).json();
    await inject("POST", "/journal", admin, {
      kind: "issue",
      severityId: await anySeverityId(),
      title: "Unrelated",
      state: "submitted",
      issueSummary: "Something else",
      departmentId: engineering.id,
    });

    // Tags are polymorphic, so the list handles this filter specially — an EXISTS on
    // taggables rather than a column match. It should return the tagged report only.
    const filters = encodeURIComponent(
      JSON.stringify([{ field: "tag", op: "eq", value: safety.id }]),
    );
    const list = (await inject("GET", `/journal?filters=${filters}`, admin)).json();
    expect(list.data.map((r: { id: string }) => r.id)).toEqual([tagged.id]);
  });

  it("refuses a tag from another department instead of dropping it silently", async () => {
    const admin = await superadmin();
    const { engineering, sales } = await twoDepartments(admin);

    const salesTag = (
      await inject("POST", "/tags", admin, { departmentId: sales.id, name: "pricing" })
    ).json();

    // Silently ignoring it would look like the save failed.
    const rejected = await inject("POST", "/journal", admin, {
      kind: "work",
      title: "Wrong department's label",
      state: "submitted",
      workSummary: "Done",
      departmentId: engineering.id,
      tagIds: [salesTag.id],
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.details.rejected).toContain(salesTag.id);
  });

  it("refuses a retired tag on new work but keeps it on what already carries it", async () => {
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);

    const tag = (
      await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "legacy" })
    ).json();
    const report = (
      await inject("POST", "/journal", admin, {
        kind: "work",
        title: "Tagged before retirement",
        state: "submitted",
        workSummary: "Done",
        departmentId: engineering.id,
        tagIds: [tag.id],
      })
    ).json();

    await inject("PATCH", `/tags/${tag.id}`, admin, { status: "inactive" });

    // The record keeps the label it was filed under...
    const stillTagged = (await inject("GET", `/journal/${report.id}`, admin)).json();
    expect(stillTagged.tags.map((t: { name: string }) => t.name)).toContain("legacy");

    // ...but it can no longer be put on anything new.
    const refused = await inject("POST", "/journal", admin, {
      kind: "work",
      title: "New work",
      state: "submitted",
      workSummary: "Done",
      departmentId: engineering.id,
      tagIds: [tag.id],
    });
    expect(refused.statusCode).toBe(400);
  });

  it("tags a task from the same vocabulary a report uses", async () => {
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);

    const tag = (
      await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "shared" })
    ).json();

    const me = (await inject("GET", "/me", admin)).json();
    const task = (
      await inject("POST", "/tasks", admin, {
        title: "Check the pump",
        assigneeIds: [me.user.id],
        departmentId: engineering.id,
        tagIds: [tag.id],
      })
    ).json();

    // Work requested and work recorded are findable by the same words.
    expect(task.tags.map((t: { name: string }) => t.name)).toEqual(["shared"]);
  });

  it("refuses to delete a tag that records carry", async () => {
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);

    const tag = (
      await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "inuse" })
    ).json();
    await inject("POST", "/journal", admin, {
      kind: "work",
      title: "Carries the tag",
      state: "submitted",
      workSummary: "Done",
      departmentId: engineering.id,
      tagIds: [tag.id],
    });

    // The link table cascades, so deleting would strip the label off a filed record.
    const refused = await inject("DELETE", `/tags/${tag.id}`, admin);
    expect(refused.statusCode).toBe(409);
  });
});

describe("the granular master permissions are separable", () => {
  it("lets a role hold tags:manage without categories or severities", async () => {
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);

    // The point of splitting report-config:manage: a group can be trusted with the
    // labels without being trusted with what a report is worth.
    const role = (
      await inject("POST", "/roles", admin, {
        name: "Tag keeper",
        permissions: ["tags:manage", "journal:read", "departments:read"],
      })
    ).json();
    const group = (await inject("POST", "/groups", admin, { name: "Taggers" })).json();
    await inject("PUT", `/groups/${group.id}/roles`, admin, { ids: [role.id] });

    const created = await inject("POST", "/users", admin, {
      name: "Tara Tagger",
      email: "tara@reportly.test",
      username: "tara",
      password: "Str0ngTempPass!x",
    });
    const userId = created.json().id;
    await inject("PUT", `/groups/${group.id}/users`, admin, { ids: [userId] });
    // Company access belongs to the person now, not to their group.
    await inject("PUT", `/users/${userId}/companies`, admin, { ids: [DEMO_COMPANY_ID] });

    const gated = await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/sign-in/username`,
      payload: { username: "tara", password: "Str0ngTempPass!x" },
    });
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/auth/change-password`,
      headers: { cookie: cookieFrom(gated) },
      payload: { currentPassword: "Str0ngTempPass!x", newPassword: "TheirOwnP4ss!ok" },
    });
    const cookie = cookieFrom(
      await app.inject({
        method: "POST",
        url: `${API_PREFIX}/auth/sign-in/username`,
        payload: { username: "tara", password: "TheirOwnP4ss!ok" },
      }),
    );

    // Holds tags:manage → may create a tag.
    expect(
      (await inject("POST", "/tags", cookie, { departmentId: engineering.id, name: "theirs" }))
        .statusCode,
    ).toBe(201);

    // Holds neither categories:manage nor report-config:manage → refused both.
    expect(
      (await inject("POST", "/categories", cookie, { departmentId: engineering.id, name: "nope" }))
        .statusCode,
    ).toBe(403);
    expect((await inject("POST", "/severities", cookie, { name: "Nope" })).statusCode).toBe(403);
  });
});

describe("company scoping (SF-006)", () => {
  /** A second company with its own department, to be the other tenant. */
  async function otherCompany(admin: string): Promise<{ companyId: string; departmentId: string }> {
    const company = (
      await inject("POST", "/companies", admin, { name: "Rival Industries" })
    ).json();
    const department = await app
      .inject({
        method: "POST",
        url: `${API_PREFIX}/departments`,
        headers: { cookie: admin, "x-company-id": company.id },
        payload: { name: "Rival Engineering" },
      })
      .then((r) => r.json());
    return { companyId: company.id, departmentId: department.id };
  }

  it("does not list another company's tags when no department is given", async () => {
    // The worst of the three: `where` was undefined without a departmentId, so an
    // unfiltered list returned every department of every company on the install —
    // over a route Member can reach.
    const admin = await superadmin();
    const other = await otherCompany(admin);

    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tags`,
      headers: { cookie: admin, "x-company-id": other.companyId },
      payload: { departmentId: other.departmentId, name: "rival-secret" },
    });

    const mine = (await inject("GET", "/tags", admin)).json();
    expect(mine.map((t: { name: string }) => t.name)).not.toContain("rival-secret");
  });

  it("does not list another company's tags when its department is named", async () => {
    const admin = await superadmin();
    const other = await otherCompany(admin);
    await app.inject({
      method: "POST",
      url: `${API_PREFIX}/tags`,
      headers: { cookie: admin, "x-company-id": other.companyId },
      payload: { departmentId: other.departmentId, name: "rival-secret" },
    });

    const res = await inject("GET", `/tags?departmentId=${other.departmentId}`, admin);
    expect(res.json()).toEqual([]);
  });

  it("refuses to create a tag in another company's department", async () => {
    const admin = await superadmin();
    const other = await otherCompany(admin);

    // Working in the demo company, naming the rival's department.
    const res = await inject("POST", "/tags", admin, {
      departmentId: other.departmentId,
      name: "planted",
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses to create a device type in another company's department", async () => {
    const admin = await superadmin();
    const other = await otherCompany(admin);
    const res = await inject("POST", "/device-types", admin, {
      departmentId: other.departmentId,
      name: "planted",
    });
    expect(res.statusCode).toBe(400);
  });

  it("still lists its own company's vocabulary", async () => {
    // The guard has to keep the feature working, not just close the hole.
    const admin = await superadmin();
    const { engineering } = await twoDepartments(admin);
    await inject("POST", "/tags", admin, { departmentId: engineering.id, name: "mine" });

    const unfiltered = (await inject("GET", "/tags", admin)).json();
    expect(unfiltered.map((t: { name: string }) => t.name)).toContain("mine");

    const filtered = (await inject("GET", `/tags?departmentId=${engineering.id}`, admin)).json();
    expect(filtered.map((t: { name: string }) => t.name)).toContain("mine");
  });
});
