// Author: Brijesh Dave <https://github.com/brijeshdave>
// The queue screens: what is sitting in each queue, and stopping one taking work.
//
// This suite runs the API with QUEUE_ADMIN=manage (see config.ts) because with it
// unset the routes are not mounted and these screens genuinely do not exist. That
// state is not tested here but where it belongs — an API test that builds the app
// in each of the three modes and asserts on 404 versus 401, which is the whole
// point of the switch and is invisible from a browser.
//
// Deliberately no retry/remove: arranging a genuinely failed job means breaking a
// worker on purpose, and a test that pauses `email` or corrupts a payload to make
// something fail leaves the rest of the suite running against a damaged stack.
import { expect, test } from "@playwright/test";

import { openNavGroup } from "./helpers.js";

test("the queues screen lists every queue and can stop one taking work", async ({ page }) => {
  await page.goto("/");
  await openNavGroup(page, "System");
  await page.getByRole("link", { name: "Queues", exact: true }).click();
  await expect(page).toHaveURL(/\/queues/);

  // Scoped to main: "Backups" and "Queues" are sidebar links too, and an
  // unscoped name matches both.
  const main = page.getByRole("main");

  // All five, by name — the registry is what this page reads, and a queue missing
  // from it is a queue nobody can see.
  for (const label of ["Email", "Notifications", "Maintenance", "Backups", "Routine awards"]) {
    await expect(main.getByRole("link", { name: label, exact: true })).toBeVisible();
  }

  // Maintenance rather than Email: pausing the queue that carries every password
  // reset would be a poor thing to leave behind if this test failed halfway.
  //
  // Found by the card holding its link rather than by position — an index would
  // silently start pausing a different queue the day the registry is reordered,
  // and this test would still pass.
  const card = main.getByRole("listitem").filter({ hasText: "Maintenance" });

  await card.getByRole("button", { name: "Pause" }).click();
  await expect(card.getByText("Paused")).toBeVisible();

  await card.getByRole("button", { name: "Resume" }).click();
  await expect(main.getByText("Paused")).toHaveCount(0);
});

test("a queue's own page shows its schedules and its jobs by state", async ({ page }) => {
  await page.goto("/queues");
  await page.getByRole("main").getByRole("link", { name: "Maintenance", exact: true }).click();
  await expect(page).toHaveURL(/\/queues\/maintenance/);

  // Maintenance is the one with repeatable schedules registered on it — the
  // "when does this next run" answer that had no home before this screen.
  await expect(page.getByText(/log-retention|notification-prune/).first()).toBeVisible();

  // Nothing has failed on a fresh stack, and the page says so in words rather
  // than showing an empty table that reads as "still loading".
  await expect(page.getByText(/no jobs|nothing/i).first()).toBeVisible();
});
