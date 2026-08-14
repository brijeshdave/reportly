// Author: Brijesh Dave <https://github.com/brijeshdave>
// The loop the whole app exists for: someone files work, finishes it, splits the
// points among whoever did it — and their manager reviews that split, which is
// what the leaderboard is finally built from.
//
// Driven as three different people through the real UI, because the interesting
// parts only exist between them: a junior cannot see the review column, a manager
// can only review people in their own reporting line, and the official figure is
// the review where there is one and the self split where there is not. None of
// that is observable from a single session.
import { expect, test } from "@playwright/test";

import {
  addMember,
  createGroup,
  createPerson,
  expectSignedIn,
  signIn,
  signInAs,
  signOut,
  superadmin,
  unique,
  type Person,
} from "./helpers.js";

/**
 * This spec signs people in and out, so it must not borrow the shared session.
 *
 * Signing out revokes the session on the server, and the saved storage state every
 * other spec loads points at exactly that token — so a sign-out here would leave
 * the rest of the suite unauthenticated. It cost eight specs the first time. A
 * clean context and its own sign-in means the only session this can revoke is one
 * it made itself.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("a junior's work is split, reviewed by their manager, and lands as points", async ({
  page,
}) => {
  const tag = unique("ap").replace(/-/g, "").slice(0, 6);
  const managerName = `Ravi ${tag}`;
  const juniorName = `Sam ${tag}`;

  await signIn(page, superadmin());
  await expectSignedIn(page);

  // --- the administrator sets the two people up and puts one under the other ---
  const managerGroup = `Line managers ${tag}`;
  const memberGroup = `Operators ${tag}`;
  await createGroup(page, managerGroup, "Manager");
  await createGroup(page, memberGroup, "Member");

  const manager = await createPerson(page, managerName, `ravi${tag}`, managerGroup);
  const junior = await createPerson(page, juniorName, `sam${tag}`, memberGroup);

  await page.goto("/departments");
  await page.getByLabel("Active company").selectOption({ index: 1 });
  await page.getByRole("button", { name: /new department/i }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Assembly ${tag}`);
  await page.getByRole("button", { name: /create department/i }).click();
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);

  await addMember(page, managerName, "hod");
  await addMember(page, juniorName, "member", managerName);
  await page.getByRole("button", { name: /save members/i }).click();
  await expect(page.getByText(/2 members/)).toBeVisible();

  await signOut(page);

  // --- the junior files the work, finishes it, and splits the points ---
  await signInAs(page, junior);
  await page.goto("/journal/new");
  const title = `Gearbox rebuild ${tag}`;
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
  const entryUrl = page.url();

  await page.getByLabel("Status").selectOption({ label: "Resolved" });
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.getByLabel(`Points for ${juniorName}`).fill("6");
  await page.getByRole("button", { name: "Save points", exact: true }).click();

  // The junior sees their own split and nothing else. The review column is the
  // manager's opinion of them, and showing it here would turn every appraisal into
  // a negotiation.
  await expect(page.getByRole("columnheader", { name: "Self" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Review" })).toHaveCount(0);

  await signOut(page);

  // --- their manager reviews it, and the review is what counts ---
  await signInAs(page, manager);
  await page.goto(entryUrl);

  await expect(page.getByRole("columnheader", { name: "Review" })).toBeVisible();
  await page.getByLabel(`Points for ${juniorName}`).fill("9");
  await page.getByRole("button", { name: "Save points", exact: true }).click();

  // Official follows the review, not the self split — that is the whole point of
  // there being two tiers rather than one number.
  const officialCell = page.getByRole("row", { name: new RegExp(juniorName) }).getByRole("cell");
  await expect(officialCell.last()).toHaveText("9");

  // And it reaches the standing the app is actually judged on. The leaderboard
  // opens on no department deliberately — "everyone, everywhere" is not a
  // standing anybody competes in — so pick the one the work was done in.
  await page.goto("/reports/leaderboard");
  await page.getByLabel("Department").selectOption({ label: `Assembly ${tag}` });
  // Choosing a department refetches the standings, and under a full-suite load
  // that round trip has exceeded the default ten seconds. Longer here rather than
  // globally: this is the one assertion in the suite waiting on a fresh query
  // triggered by a select, and raising the default would slow every real failure.
  await expect(page.getByText(juniorName).first()).toBeVisible({ timeout: 25_000 });
});
