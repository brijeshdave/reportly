// Author: Brijesh Dave <https://github.com/brijeshdave>
// End users through the screens: add somebody to the register, file an issue against
// them, and find them in the report.
//
// The integration tests prove the rules against the API. What only a browser can show
// is the part that is a UI decision rather than a server one: the journal's End user
// list narrowing to the department chosen beside it, and the department target
// stepping aside the moment a person is named.
import { expect, test, type Page } from "@playwright/test";

import {
  addMember,
  pickFromCombo,
  pickPeople,
  submitIssue,
  superadminName,
  unique,
} from "./helpers.js";

/**
 * The journal derives an entry's department from the author's own memberships, and
 * the seeded superadmin belongs to none — so without this every form here reads "You
 * are not in a department yet" and cannot be submitted. Same setup as the reporting
 * spec, and idempotent for the same reason.
 */
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/departments");
  await page.getByLabel("Active company").selectOption({ index: 1 });
  await page
    .getByRole("link", { name: /Engineering/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);
  await page.getByRole("tab", { name: /members/i }).click();

  const already = await page
    .getByText(superadminName(), { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (!already) {
    await addMember(page, superadminName(), "hod");
    await page.getByRole("button", { name: /save members/i }).click();
    await expect(page.getByText(superadminName()).first()).toBeVisible();
  }
  await page.close();
});

async function pickCompany(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Active company").selectOption({ index: 1 });
}

test("adds an end user, records an issue against them, and reports on it", async ({ page }) => {
  const tag = unique("e").replace(/-/g, "").slice(0, 8);
  const person = `Asha ${tag}`;
  const employeeNumber = `EMP-${tag}`;

  await pickCompany(page);

  // 1. On the register.
  await page.goto("/end-users");
  await page.getByRole("button", { name: /new end user/i }).click();
  await expect(page).toHaveURL(/\/end-users\/new/);
  await page.getByLabel("Full name").fill(person);
  await page.getByLabel("Employee number").fill(employeeNumber);
  // The department is what the journal narrows by, so it is the point of this step.
  await pickFromCombo(page, "Department", "Engineering");
  await page.getByRole("button", { name: /add end user/i }).click();

  // A create lands on the record it just made.
  await expect(page).toHaveURL(/\/end-users\/[0-9a-f-]{36}\/edit/);
  await expect(page.getByText(/0 entries/)).toBeVisible();

  // 2. File an issue about them.
  await page.goto("/journal/new");
  await page.getByLabel("Title").fill(`Laptop will not boot — ${tag}`);

  // The department first: the End user list is narrowed by it, which is the whole
  // interaction this test exists for.
  await pickPeople(page, "Departments this report is about", "Engineering");
  await expect(page.getByRole("button", { name: /^Remove Engineering$/ })).toBeVisible();

  await pickPeople(page, "End users this report is about", person);

  // Naming somebody replaces the department target — the entry is about them, not
  // about everybody in the department.
  await expect(
    page.getByRole("button", { name: `Remove ${person} (${employeeNumber})` }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Remove Engineering$/ })).toHaveCount(0);

  await submitIssue(page);
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
  // The label the server resolves, employee number and all.
  await expect(page.getByText(`${person} (${employeeNumber})`).first()).toBeVisible();

  // 3. The report finds them.
  await page.goto("/reports/end-users");
  const row = page.getByRole("row", { name: new RegExp(person) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(employeeNumber);

  // 4. Named on an entry, they cannot be deleted — the register says so, and the
  // server refuses it.
  await page.goto("/end-users");
  await page.getByRole("link", { name: person }).click();
  await expect(page.getByText("1 entry", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^delete$/i }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /delete end user/i })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/named on|inactive/i).first()).toBeVisible();

  // So they are made inactive instead, which is the way out — and the entry that
  // names them is untouched. The dialog's own Cancel: the form behind it has one too.
  await dialog.getByRole("button", { name: /^cancel$/i }).click();
  await page.getByLabel(/offered in the journal/i).uncheck();
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByText("1 entry", { exact: true })).toBeVisible();

  // Out of the journal's picker, still on the record.
  await page.goto("/journal/new");
  await pickPeople(page, "Departments this report is about", "Engineering");
  await page.getByLabel("End users this report is about", { exact: true }).click();
  await expect(page.getByRole("listbox").locator(`[data-label^="${person}"]`)).toHaveCount(0);
});
