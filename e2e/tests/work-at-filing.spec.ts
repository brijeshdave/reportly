// Author: Brijesh Dave <https://github.com/brijeshdave>
// Filing an issue with the work already done, driven through the screens.
//
// Reported from use, and the integration tests could only prove half of it: with
// "Require work on issue" on, an entry submitted *with* Work done filled in saved
// cleanly and then showed an empty Work log. The entry's work columns are a roll-up
// of the work timeline, and the filing form was writing them directly — so the gate
// read a column nothing else agreed with, the tab that reads the timeline had nothing
// to show, and the first genuine work log overwrote the text somebody had typed.
//
// This is the part fastify.inject cannot tell you: that the screen a person actually
// uses puts the work where the screen that reads it looks.
import { expect, test, type Page } from "@playwright/test";

import { addMember, superadminName, unique } from "./helpers.js";

/** The editor derives the department from the author's own memberships, so the
 *  signed-in superadmin has to be on one before anything here can be submitted. */
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
  // Idempotent: the file may be re-run against a database that already has it.
  const already = await page
    .getByText(superadminName(), { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (!already) {
    await addMember(page, superadminName(), "hod");
    await page.getByRole("button", { name: /save members/i }).click();
    // A successful save DISABLES the button — there is nothing left pending.
    await expect(page.getByText(superadminName()).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /save members/i })).toBeDisabled();
  }
  await page.close();
});

async function pickCompany(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Active company").selectOption({ index: 1 });
}

test("work typed on the filing form becomes the entry's first work log item", async ({ page }) => {
  const title = `Belt snapped ${unique("w").replace(/-/g, "").slice(0, 8)}`;
  await pickCompany(page);

  await page.goto("/journal/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Severity").selectOption({ index: 1 });

  // The shortcut the complaint was about: an issue whose work is already finished.
  await page.getByLabel("I already did the work").check();
  await page.getByLabel("Summary").fill("Replaced the drive belt");
  await page.getByLabel("Details").fill("Spare from the east store.");

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);

  // The bug, as a person saw it: this card read "Nothing logged yet" while the form
  // that refuses an empty submit had just accepted one. That exact string, because an
  // open entry never shows the other empty state ("No work was logged against this
  // entry" is the closed one) — asserting the wrong one passes without proving
  // anything, which is what the first draft of this test did.
  await expect(page.getByText(/Nothing logged yet/i)).toBeHidden();
  await expect(page.getByText("Replaced the drive belt").first()).toBeVisible();
  await expect(page.getByText("Spare from the east store.").first()).toBeVisible();
  await page.screenshot({ path: "test-results/work-at-filing.png", fullPage: true });

  // And the sharp end of it: the roll-up is recomputed from the timeline on every
  // write, so a second item used to take the first one's place rather than follow it.
  await page.getByRole("button", { name: "Log work", exact: true }).click();
  await page.getByLabel("What you did").fill("Greased the bearings");
  await page.getByRole("button", { name: "Save work", exact: true }).click();
  await expect(page.getByText("Greased the bearings").first()).toBeVisible();
  await expect(page.getByText("Replaced the drive belt").first()).toBeVisible();
});

test("editing an entry sends you to the work log rather than offering the roll-up", async ({
  page,
}) => {
  // The edit form used to draw Work done as ordinary fields. They wrote a column
  // derived from the timeline, so the next work log overwrote the correction and the
  // edit only appeared to stick. It now says where a correction belongs instead.
  const title = `Pump seized ${unique("w").replace(/-/g, "").slice(0, 8)}`;
  await pickCompany(page);

  await page.goto("/journal/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Severity").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);

  // Straight to the route. The detail page's Edit is a button well down the page and
  // a work item carries its own "Edit", so driving it by name is a locator that will
  // break for reasons this test is not about; the screen under test is the editor.
  await page.goto(`${new URL(page.url()).pathname}/edit`);
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByText(/Work is logged on the entry itself/i)).toBeVisible();
  await expect(page.getByLabel("Summary")).toBeHidden();
  await page.screenshot({ path: "test-results/work-on-edit.png", fullPage: true });
});
