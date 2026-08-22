// Author: Brijesh Dave <https://github.com/brijeshdave>
// The administrator's half of the sign-in throttle, through a real browser.
//
// The counting is covered by unit and integration tests. What only a whole stack
// can show is the thing that was actually missing when this was reported: somebody
// locked out, an administrator able to *see* that from the roster, and a way to let
// them back in — with the lock read from a live counter rather than a column.
import { expect, test } from "@playwright/test";

import { createPerson, unique } from "./helpers.js";

/**
 * This stack deliberately runs with the sign-in limit raised to 1000, so that a
 * suite which signs in dozens of times does not throttle itself (see
 * `global-setup.ts`). This is the one spec that needs the limit to actually bite,
 * so it lowers the ceiling for its own duration and puts it back afterwards —
 * `workers: 1`, so nothing else is signing in meanwhile.
 */
const NORMAL = { signInMax: 1000, signInWindowSeconds: 60 };
const STRICT = { signInMax: 3, signInWindowSeconds: 60 };

test("shows who the sign-in throttle is holding out, and releases them", async ({
  page,
  browser,
  baseURL,
}) => {
  const setLimit = async (value: typeof NORMAL) => {
    const res = await page.request.put(new URL("/api/v1/settings/auth/rateLimit", baseURL).href, {
      data: { value },
    });
    expect(res.ok()).toBe(true);
  };

  // The suite arrives signed in as the superadmin, which is who would be doing this.
  const username = unique("locked");
  const person = await createPerson(page, "Barred Person", username, "Superadmin");
  await setLimit(STRICT);

  try {
    // Lock them out the way they would do it to themselves: the wrong password at
    // the login form, over and over. Not a scripted POST — better-auth refuses a
    // request with no Origin before it ever reaches a password, so that would
    // prove nothing about the throttle.
    const theirs = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const theirPage = await theirs.newPage();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await theirPage.goto("/login");
      await theirPage.getByLabel("Email").fill(`${username}@reportly.test`);
      await theirPage.getByLabel("Password", { exact: true }).fill("definitely-not-the-password");
      await theirPage.getByRole("button", { name: "Sign in" }).click();
      await expect(theirPage.getByRole("alert")).toBeVisible();
    }

    // What they are told once the allowance is gone: not "wrong password" any more,
    // but that they are locked out and somebody can let them back in.
    await expect(theirPage.getByRole("alert")).toContainText(/too many failed attempts/i);
    await theirs.close();

    // The roster says so, without opening anybody. `exact` matters: getByText is
    // case-insensitive, so a looser locator would match this person's own name and
    // pass whether or not the badge was ever drawn.
    await page.goto("/users");
    const row = page.getByRole("row").filter({ hasText: "Barred Person" });
    await expect(row.getByText("Locked out", { exact: true })).toBeVisible();

    // And the account's own page offers the way out.
    await page.goto(`/users/${person.id}?tab=security`);
    await expect(page.getByText("Sign-in lockout")).toBeVisible();
    const release = page.getByRole("button", { name: "Release" });
    await expect(release).toBeEnabled();
    await release.click();
    await expect(page.getByText(/Released\./)).toBeVisible();

    // Released means released: the roster stops saying it.
    await page.goto("/users");
    await expect(row.getByText("Locked out", { exact: true })).toHaveCount(0);
  } finally {
    await setLimit(NORMAL);
  }
});
