// Author: Brijesh Dave <https://github.com/brijeshdave>
// Organisation management the way an admin does it: create a company, open it,
// add a location inside it, then delete the company and watch it leave the list.
// This is the create→read→delete path through the real UI, not the API underneath.
import { expect, test } from "@playwright/test";

import { unique } from "./helpers.js";

test("creates a company, adds a location, and deletes it", async ({ page }) => {
  const companyName = unique("E2E Co");
  const locationName = unique("Site");

  await page.goto("/companies");
  await page.getByRole("button", { name: /new company/i }).click();
  // Exact match: getByLabel("Name") otherwise substring-matches the "Rename …"
  // buttons on a company that already has locations.
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(companyName);
  await page.getByRole("button", { name: /create company/i }).click();

  // Land on the new company's detail page.
  await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: companyName })).toBeVisible();

  // Locations live on a tab inside the company.
  await page.getByRole("tab", { name: /locations/i }).click();
  await page.getByRole("button", { name: /new location|add location/i }).click();
  const locationDialog = page.getByRole("dialog");
  await locationDialog.getByLabel("Name", { exact: true }).fill(locationName);
  await locationDialog
    .getByRole("button", { name: /create|add|save/i })
    .first()
    .click();
  await expect(page.getByText(locationName)).toBeVisible();

  // Delete the company and confirm it is gone from the list. The company has
  // locations, so the confirm dialog names the cascade; its button carries a
  // "Delete company…" label either way.
  await page.getByRole("button", { name: /delete company/i }).click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("button", { name: /delete company/i }).click();

  await expect(page).toHaveURL(/\/companies\/?$/);
  await expect(page.getByText(companyName)).toHaveCount(0);
});
