// Author: Brijesh Dave <https://github.com/brijeshdave>
// A deactivated company is closed for business, not merely labelled.
//
// Reported from production: "if i inactivate any company, it should not allow any
// new masters or transaction. but currently it allows." The flag was written,
// listed and displayed, and read by nothing.
//
// The refusal itself is pinned by integration tests. What needs a browser is the
// part a person actually meets: that switching into such a company tells you where
// you are, rather than letting you fill in a form and meet a red box at Save.
import { expect, test } from "@playwright/test";

import { unique } from "./helpers.js";

test("says a company is closed before you try to file anything into it", async ({ page }) => {
  const name = unique("Closed Co");

  await page.goto("/companies");
  await page.getByRole("button", { name: "New company" }).click();
  const dialog = page.getByRole("dialog", { name: "New company" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create" }).click();

  // Creating one opens it, so this is already its page.
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const companyUrl = page.url();
  await page.getByRole("button", { name: "Deactivate" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("inactive").first()).toBeVisible();

  // The switcher says so in the list itself, before it is even chosen.
  const switcher = page.getByLabel("Active company");
  await expect(switcher.getByRole("option", { name: `${name} (deactivated)` })).toBeAttached();

  // And once you are in it, the whole app says so at the top of every screen.
  await switcher.selectOption({ label: `${name} (deactivated)` });
  await expect(page.getByText(`${name} is deactivated.`)).toBeVisible();
  await expect(page.getByText(/nothing new can be added/i)).toBeVisible();

  // And the buttons that could only fail are not offered.
  await page.goto(companyUrl);
  await expect(page.getByRole("button", { name: "Add location" })).toBeDisabled();
});
