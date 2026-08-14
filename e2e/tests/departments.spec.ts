// Author: Brijesh Dave <https://github.com/brijeshdave>
// Departments the way an admin uses them: pick a company, create a department on
// its own page, then make a user a member and Head of Department — the
// create→assign path through the real UI, not the API underneath.
import { expect, test } from "@playwright/test";

import { addMember, superadminName, unique } from "./helpers.js";

test("creates a department and sets a member as HOD", async ({ page }) => {
  const name = unique("E2E Dept");

  await page.goto("/departments");

  // Departments belong to a company; pick the first real one in the top-bar
  // switcher (index 0 is the "All companies" placeholder).
  await page.getByLabel("Active company").selectOption({ index: 1 });

  // The seeded demo tree is visible for the company.
  await expect(page.getByRole("link", { name: /Engineering/ })).toBeVisible();

  // Create a new department on its dedicated page.
  await page.getByRole("button", { name: /new department/i }).click();
  await expect(page).toHaveURL(/\/departments\/new/);
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: /create department/i }).click();

  // Land on the new department's detail page.
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // Make the superadmin a member and Head of Department. People are searched for
  // and clicked — see addMember.
  await page.getByRole("tab", { name: /members/i }).click();
  await addMember(page, superadminName(), "hod");
  await page.getByRole("button", { name: /save members/i }).click();

  // The header count reflects the saved membership.
  await expect(page.getByText(/1 member/)).toBeVisible();
  await expect(page.getByText(/1 HOD/)).toBeVisible();

  // Back on the tree, the new department is listed with its member count.
  await page.goto("/departments");
  const row = page.getByRole("link", { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("1 HOD");

  // Clean up through the UI: a department with members cannot be deleted, so
  // remove the member first, then delete the now-empty department.
  await row.click();
  await page.getByRole("tab", { name: /members/i }).click();
  await page.getByLabel(`Remove ${superadminName()}`).click();
  await page.getByRole("button", { name: /save members/i }).click();
  await expect(
    page.getByText(/0 members|No members|Nobody in this department/i).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: /^delete$/i }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /delete department/i })
    .click();
  await expect(page).toHaveURL(/\/departments\/?$/);
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
});
