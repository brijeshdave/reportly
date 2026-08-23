// Author: Brijesh Dave <https://github.com/brijeshdave>
// Last seen, and who is signed in right now.
//
// Asked for from production: a last-login column in the users table, plus filters
// for live and long-inactive people — "shown if proper permissions are there, not
// for all having view rights".
import { expect, test } from "@playwright/test";

import { ADMIN_CHOSEN, createPerson, unique } from "./helpers.js";

test("shows when somebody was last seen, and who is signed in now", async ({ page, browser }) => {
  const username = unique("seen");
  const person = await createPerson(page, "Seen Person", username, "Superadmin");

  await page.goto("/users");
  const row = page.getByRole("row").filter({ hasText: "Seen Person" });

  // Created but never signed in: honestly "Never", not a blank or today's date.
  await expect(row.getByText("Never", { exact: true })).toBeVisible();

  // Now they sign in, in their own browser.
  const theirs = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const theirPage = await theirs.newPage();
  await theirPage.goto("/login");
  await theirPage.getByLabel("Email").fill(`${username}@reportly.test`);
  await theirPage.getByLabel("Password", { exact: true }).fill(ADMIN_CHOSEN);
  await theirPage.getByRole("button", { name: "Sign in" }).click();
  // They are made to choose their own password before anything else.
  await expect(theirPage.getByText(/choose|password/i).first()).toBeVisible();

  await page.reload();
  await expect(row.getByText("Signed in")).toBeVisible();
  await expect(row.getByText("Never", { exact: true })).toHaveCount(0);

  // And the filter finds them among the live.
  await page.goto(`/users/${person.id}?tab=sessions`);
  await expect(page.getByRole("tab", { name: "Sessions" })).toBeVisible();

  await theirs.close();
});
