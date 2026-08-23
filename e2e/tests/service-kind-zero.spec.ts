// Author: Brijesh Dave <https://github.com/brijeshdave>
// A service kind that consumes nothing: least 0, most 0.
//
// Reported twice from production: "for cartridge service kind when i edit and make
// all parts min 0 and max 0 as there may be repair without any part, ui gives error
// — Request validation failed", and then that the edit could not be saved at all.
//
// A schema fix went in for the first half. This exists because a schema test proves
// the schema and nothing else: the number has to survive the form, the wire, the
// route's own validation and the save, and only a browser walks all four.
import { expect, test } from "@playwright/test";

import { unique } from "./helpers.js";

/** The company's own switch for the cartridges module. */
async function openModules(page: import("@playwright/test").Page) {
  await page.goto("/companies");
  await page.getByRole("table").getByRole("link").first().click();
  await page.getByRole("tab", { name: "Modules" }).click();
}

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Active company").selectOption({ index: 1 });
});

test("a repair that uses no parts saves, and stays saved", async ({ page }) => {
  // The module is optional and off by default, so turn it on rather than assume
  // whatever the last run left behind.
  await openModules(page);
  const toggle = page.getByRole("button", { name: /^Switch (on|off)$/ });
  await toggle.waitFor();
  // The button says what it will do, so "Switch on" means the module is off.
  // Getting this backwards leaves every cartridge screen answering 404 — which is
  // the module guard behaving correctly, and looks exactly like a broken page.
  if ((await toggle.textContent())?.includes("on")) await toggle.click();
  await expect(page.getByRole("button", { name: "Switch off" })).toBeVisible();

  const kind = unique("Repair");
  const consumable = unique("Drum");

  await page.goto("/cartridges/setup?tab=consumables");
  await page.getByLabel("Name").fill(consumable);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(consumable)).toBeVisible();

  await page.goto("/cartridges/setup?tab=kinds");
  await page.getByLabel("Name").fill(kind);
  await page.getByLabel("Default points").fill("3");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(kind)).toBeVisible();

  // Tick the consumable, then say it may use none of it: a repair that replaces
  // nothing is still a repair.
  // The rules editor is behind the row's own "Uses" button — the kind offers every
  // consumable until somebody narrows it.
  // Anchored on the row that *has* the button: filtering on the name alone lands
  // on the innermost div, which holds the description and no controls.
  const row = page
    .locator("div")
    .filter({ hasText: kind })
    .filter({ has: page.getByRole("button", { name: "Uses" }) })
    .last();
  await row.getByRole("button", { name: "Uses" }).click();
  const card = page
    .locator("div")
    .filter({ hasText: `What ${kind} uses` })
    .last();
  await card.getByRole("checkbox").first().check();
  await card.getByLabel(`Least ${consumable}`).fill("0");
  await card.getByLabel(`Most ${consumable}`).fill("0");
  await card.getByRole("button", { name: /save/i }).click();

  // The report was a red "Request validation failed" here.
  await expect(page.getByText(/validation failed/i)).toHaveCount(0);

  // And it must have actually been written, not merely accepted by the screen.
  await page.reload();
  await page
    .locator("div")
    .filter({ hasText: kind })
    .filter({ has: page.getByRole("button", { name: "Uses" }) })
    .last()
    .getByRole("button", { name: "Uses" })
    .click();
  const saved = page
    .locator("div")
    .filter({ hasText: `What ${kind} uses` })
    .last();
  await expect(saved.getByLabel(`Least ${consumable}`)).toHaveValue("0");
  await expect(saved.getByLabel(`Most ${consumable}`)).toHaveValue("0");
});
