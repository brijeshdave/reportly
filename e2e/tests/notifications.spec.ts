// Author: Brijesh Dave <https://github.com/brijeshdave>
// The bell: something happens to you, and you are told about it without having to
// go looking.
//
// Worth driving in a browser rather than trusting the API tests, because the
// interesting part is the seam. A notification is written by a background worker
// after the request that caused it has already returned, so "did it arrive" is a
// question about the queue, the worker, the inbox query and the poll together —
// and every one of those has been green on its own while the bell stayed empty.
import { expect, test } from "@playwright/test";

import {
  addMember,
  createGroup,
  createPerson,
  expectSignedIn,
  pickFromCombo,
  signIn,
  signInAs,
  signOut,
  superadmin,
  superadminName,
  unique,
} from "./helpers.js";

// Signs people in and out, so it takes its own session.
test.use({ storageState: { cookies: [], origins: [] } });

test("a task assigned to somebody reaches their bell, and can be cleared", async ({ page }) => {
  const tag = unique("nt").replace(/-/g, "").slice(0, 6);
  const staffName = `Asha ${tag}`;
  const title = `Replace the intake filter ${tag}`;

  await signIn(page, superadmin());
  await expectSignedIn(page);
  await page.getByLabel("Active company").selectOption({ index: 1 });

  const staffGroup = `Notified staff ${tag}`;
  await createGroup(page, staffGroup, "Member");
  const staff = await createPerson(page, staffName, `asha${tag}`, staffGroup);

  // Tasks may only be handed to your own downline, so the line has to exist
  // before there is anybody to assign to.
  await page.goto("/departments");
  await page.getByRole("button", { name: /new department/i }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Filtration ${tag}`);
  await page.getByRole("button", { name: /create department/i }).click();
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);
  await addMember(page, superadminName(), "hod");
  await addMember(page, staffName, "member", superadminName());
  await page.getByRole("button", { name: /save members/i }).click();
  await expect(page.getByText(/2 members/)).toBeVisible();

  // --- the thing that happens ---
  await page.goto("/tasks/new");
  await page.getByLabel("Title").fill(title);
  await pickFromCombo(page, "Assign to", staffName);
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);

  await signOut(page);

  // --- and the person it happened to is told ---
  await signInAs(page, staff);

  // Delivery is a queued job, so the count arrives a moment after the request that
  // caused it returned. Watch the label rather than reloading in a loop: the first
  // version reloaded and read the attribute in the same breath, which sampled the
  // bell before its own fetch had resolved and so read "Notifications" every time —
  // while the page it screenshotted on failure plainly said "1 unread".
  const bell = page.getByRole("button", { name: /^Notifications/ });
  // A reload between the two waits, because the count is deliberately not chatty:
  // it polls once a minute and holds its answer for thirty seconds, so a page that
  // asked before the worker had written simply keeps saying nothing. Reloading is
  // what a person does, and it remounts the query.
  await expect
    .poll(
      async () => {
        // Wait for the count's own response rather than a guess at how long it
        // takes: reload, let the remounted query answer, then read what the bell
        // is showing.
        await Promise.all([
          page.waitForResponse((r) => r.url().includes("/me/notifications/unread-count")),
          page.reload(),
        ]);
        return bell.getAttribute("aria-label");
      },
      { timeout: 45_000, message: "the assigned task never reached the bell" },
    )
    .toMatch(/1 unread/);

  await bell.click();
  const panel = page.getByRole("menu", { name: "Notifications" });
  await expect(panel.getByText(new RegExp(title))).toBeVisible();

  // Clearing it is the other half: a bell that only ever counts up is one people
  // stop looking at.
  await panel.getByRole("button", { name: "Mark all read" }).click();
  await expect(bell).toHaveAttribute("aria-label", "Notifications");
});
