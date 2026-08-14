// Author: Brijesh Dave <https://github.com/brijeshdave>
// Recurring work: an administrator sets a routine up and assigns it, and the
// person holding it logs the occurrence they actually did.
//
// The logging half is the daily act for most staff — the one screen a technician
// touches every shift — and it had no browser cover at all. The API had tests; a
// form that never submits is invisible to those.
import { expect, test } from "@playwright/test";

import { addMember, superadminName, unique } from "./helpers.js";

test("creates a daily routine, assigns it, and logs today's occurrence", async ({ page }) => {
  const tag = unique("rt").replace(/-/g, "").slice(0, 6);
  const title = `Boiler pressure check ${tag}`;

  await page.goto("/");
  await page.getByLabel("Active company").selectOption({ index: 1 });

  // A routine is credited to a department on the leaderboard, so its owner has to
  // be in one — the form says "You are in no department" and stays unsaveable
  // otherwise, which is the right refusal and not a thing to work around.
  await page.goto("/departments");
  await page.getByRole("button", { name: /new department/i }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Boiler house ${tag}`);
  await page.getByRole("button", { name: /create department/i }).click();
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);
  await addMember(page, superadminName(), "hod");
  await page.getByRole("button", { name: /save members/i }).click();
  await expect(page.getByText(/1 member/)).toBeVisible();

  // --- set it up ---
  await page.goto("/routines/manage/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Cadence").selectOption("daily");
  await page.getByLabel("Points", { exact: true }).fill("3");

  // The superadmin assigns it to themselves — the point here is the logging half,
  // and a routine with nobody on it has no occurrences to log.
  await page.getByLabel("Assignees").click();
  await page.getByRole("listbox").getByRole("option").first().click();
  await page.mouse.click(5, 5);

  await page.getByRole("button", { name: "Create routine" }).click();
  await expect(page).toHaveURL(/\/routines\/manage/);

  // --- the person holding it logs the work ---
  await page.goto("/routines");
  // Not `getByText(title)`: the page's own "Routine" filter holds an <option> with
  // the same words, and Playwright counts an option as hidden. The cadence line is
  // the card's own text.
  await expect(page.getByText(/Daily · Every day/).first()).toBeVisible();

  // Occurrences are a table, one row per date. Take the first one still pending.
  const pending = page.getByRole("row").filter({ hasText: "Pending" }).first();
  await pending.getByRole("button", { name: "Log", exact: true }).click();

  // Finished is what the log turns on: an occurrence with no end has not happened
  // yet, so the save stays disabled until there is one.
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Started").fill(local);
  await page.getByLabel("Finished").fill(local);
  await page.getByRole("button", { name: "Save log", exact: true }).click();

  // Logged: the occurrence reads Done, and its button now offers to correct the
  // entry rather than to do the work again.
  await expect(page.getByRole("row").filter({ hasText: "Done" }).first()).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Done" }).first().getByRole("button", { name: "Edit" }),
  ).toBeVisible();
});
