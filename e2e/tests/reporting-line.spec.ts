// Author: Brijesh Dave <https://github.com/brijeshdave>
// The reporting line, built the way an admin would build it, and then read back as
// the downline that report visibility will be scoped on.
//
// The shape is the real one: an HOD reporting up into Management (a *different*
// department), two team leaders under them — one covering two sites — and juniors
// under the leaders. What matters is that the boss ends up seeing all of them, not
// just the person directly beneath him.
import { expect, test, type Page } from "@playwright/test";

import { addMember, unique } from "./helpers.js";

/**
 * Create a user through the UI and hand back their id.
 *
 * The id, not the name: reaching someone by clicking their link on /users only works
 * while they happen to be on the first page of it. That is a property of how much
 * other data exists, which is not what this test is about.
 */
async function createUser(page: Page, name: string, username: string): Promise<string> {
  await page.goto("/users/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(`${username}@reportly.test`);
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}/);
  return page.url().split("/").pop()!;
}

test("builds a reporting line and reads back the whole downline", async ({ page }) => {
  const tag = unique("h").replace(/-/g, "").slice(0, 8);
  const boss = `Boss ${tag}`;
  const hod = `Asha ${tag}`;
  const lead = `Ravi ${tag}`;
  const junior = `Sam ${tag}`;

  const bossId = await createUser(page, boss, `boss${tag}`);
  await createUser(page, hod, `asha${tag}`);
  await createUser(page, lead, `ravi${tag}`);
  const juniorId = await createUser(page, junior, `sam${tag}`);

  // Two departments: the HOD will report UP out of theirs, into Management.
  await page.goto("/departments");
  await page.getByLabel("Active company").selectOption({ index: 1 });

  const management = `Exec ${tag}`;
  const platform = `Platform ${tag}`;

  await page.getByRole("button", { name: /new department/i }).click();
  await page.getByLabel("Name", { exact: true }).fill(management);
  await page.getByRole("button", { name: /create department/i }).click();
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);

  // The boss sits at the top of Management, reporting to nobody.
  await addMember(page, boss, "hod");
  await page.getByRole("button", { name: /save members/i }).click();
  await expect(page.getByText(/1 member/)).toBeVisible();

  await page.goto("/departments");
  await page.getByRole("button", { name: /new department/i }).click();
  await page.getByLabel("Name", { exact: true }).fill(platform);
  await page.getByLabel("Parent department").selectOption({ label: management });
  await page.getByRole("button", { name: /create department/i }).click();
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);

  // HOD → boss (across departments), lead → HOD, junior → lead.
  await addMember(page, hod, "hod", boss);
  await addMember(page, lead, "lead", hod);
  await addMember(page, junior, "member", lead);
  await page.screenshot({ path: "test-results/members-editor.png", fullPage: true });
  await page.getByRole("button", { name: /save members/i }).click();
  await expect(page.getByText(/3 members/)).toBeVisible();

  // Read it back from the boss's side: he must see all three, not just the HOD.
  await page.goto(`/users/${bossId}`);
  await page.getByRole("tab", { name: "Departments" }).click();

  // Read from the membership row, not the read-only card: this session may edit
  // memberships, and somebody who can is shown the editable row *instead* of the
  // card — the same fact twice on one screen was the thing that made a person
  // wonder which one was real.
  await expect(page.getByLabel(`Reports to in ${management}`)).toHaveText(/Nobody/);
  for (const person of [hod, lead, junior]) {
    await expect(page.getByRole("link", { name: person })).toBeVisible();
  }
  await page.screenshot({ path: "test-results/downline.png", fullPage: true });

  // And the junior, at the bottom, is below nobody.
  await page.goto(`/users/${juniorId}`);
  await page.getByRole("tab", { name: "Departments" }).click();
  await expect(page.getByLabel(`Reports to in ${platform}`)).toHaveText(lead);
  await expect(page.getByText("Nobody reports to them.")).toBeVisible();
});
