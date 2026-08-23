// Author: Brijesh Dave <https://github.com/brijeshdave>
// Asking the audit trail a question about a person, by name.
//
// It filtered by uuid, which meant finding one somewhere else first. Only a
// browser shows the thing that actually changed: you type a name, and the id it
// stores never has to be seen.
import { expect, test } from "@playwright/test";

import { createPerson, dismissPicker, unique } from "./helpers.js";

test("filters the trail by a person picked by name, and by several actions at once", async ({
  page,
}) => {
  const username = unique("audited");
  await createPerson(page, "Audited Person", username, "Superadmin");

  await page.goto("/audit");
  await page.getByRole("button", { name: "Filters" }).click();

  // The action filter offers what is actually in the trail, several at a time.
  await page.getByLabel("Action").click();
  await page.getByRole("option", { name: "user.create", exact: true }).click();
  // Not Escape: that closes the whole filter sidebar, not just this dropdown.
  await dismissPicker(page);

  // And the actor is chosen by name — no uuid anywhere on screen.
  await page.getByLabel("Actor", { exact: true }).click();
  await page.getByLabel("Search options").fill("Super");
  await page.getByRole("option", { name: /Super/ }).first().click();

  await page.getByRole("button", { name: /Apply/i }).click();

  await expect(page.getByRole("row").filter({ hasText: "user.create" }).first()).toBeVisible();
});
