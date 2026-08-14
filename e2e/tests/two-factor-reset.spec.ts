// Author: Brijesh Dave <https://github.com/brijeshdave>
// The two-factor recovery path, end to end: a user enrols a second factor, "loses"
// it, and an administrator removes it so they can get back in.
//
// This is the one thing an admin may do to somebody else's second factor. They
// cannot turn it on — that needs the authenticator in the person's own hands — so
// this test enrols as the user, then comes back as the admin to take it away.
import { expect, test } from "@playwright/test";

import { expectSignedIn, signIn, signOut, superadmin, unique } from "./helpers.js";
import { secretFromOtpauthUri, totp } from "./totp.js";

const THEIR_PASSWORD = "TheirOwnP4ss!ok";

/**
 * A session of its own, because this test signs out.
 *
 * The shared storageState holds one real server-side session, and signing out of it
 * ends that session for every spec that runs afterwards — they arrive at the login
 * form with no clue why. A spec that signs out has to own the session it signs out
 * of; auth.spec and navigation.spec do the same, for the same reason.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test("an admin removes two-factor from a user who lost their device", async ({ page }) => {
  const admin = superadmin();
  await signIn(page, admin);
  await expectSignedIn(page);
  const username = unique("liz").replace(/-/g, "").slice(0, 20).toLowerCase();
  const email = `${username}@reportly.test`;

  // --- the admin creates them, with a password so they can sign in at once ---
  await page.goto("/users/new");
  await page.getByLabel("Full name").fill("Liz Lost-Phone");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Set a password now").check();
  await page.getByLabel("Password", { exact: true }).fill(THEIR_PASSWORD);
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}/);
  const userUrl = page.url();

  // Before they enrol anything, the admin's view says so — and offers nothing to
  // remove, because there is nothing to remove.
  await page.getByRole("tab", { name: "Security" }).click();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);

  // --- as that person: replace the admin-chosen password, then enrol 2FA ---
  await signOut(page);
  await page.waitForURL("**/login**");
  await page.getByLabel("Email or username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(THEIR_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // The admin chose their password, so they are sent straight to change it. Wait
  // for that landing rather than assuming it: a sign-in that quietly failed would
  // otherwise show up as a confusing "field not found" several steps later.
  await page.waitForURL("**/profile**");

  const ownPassword = "MyRealP4ssword!ok";
  await page.getByLabel("Current password").fill(THEIR_PASSWORD);
  await page.getByLabel("New password", { exact: true }).fill(ownPassword);
  await page.getByLabel("Confirm new password").fill(ownPassword);
  await page.getByRole("button", { name: /change password/i }).click();
  await expect(page.getByRole("alert").filter({ hasText: /password needs changing/i })).toHaveCount(
    0,
  );

  const card = page.locator("form,section,div").filter({ hasText: "Two-factor authentication" });
  await page.getByRole("button", { name: "Set up two-factor" }).click();
  const passwordStep = page.locator("form").filter({ hasText: "Confirm your password to start" });
  await passwordStep.getByLabel("Current password").fill(ownPassword);
  await passwordStep.getByRole("button", { name: "Continue" }).click();

  // Wait for the enrolment panel before reading anything out of it — the secret
  // arrives with the response, and reading too early picks up whatever <code> the
  // page happened to be showing (a recovery code, or an error's reference id).
  await expect(page.getByLabel("Authentication code")).toBeVisible();

  // Pick the code element that *is* a base32 secret rather than trusting its
  // position: the recovery codes are <code> too, and so is an error reference.
  const setupKey = (await page.locator("code").allInnerTexts())
    .map((text) => text.trim())
    .find((text) => /^[A-Z2-7]{16,}$/.test(text) || text.includes("otpauth://"));
  expect(setupKey, "no TOTP setup key was shown").toBeTruthy();
  const secret = setupKey!.includes("otpauth://") ? secretFromOtpauthUri(setupKey!) : setupKey!;

  await page.getByLabel(/I have saved these codes/i).check();
  await page.getByLabel("Authentication code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(card.getByText("On", { exact: true })).toBeVisible();

  // Their phone now goes in the sea, along with the recovery codes.

  // --- back as the admin, take the factor off so they can enrol again ---
  await signOut(page);
  await signIn(page, admin);
  // Wait for the session to actually land, or the next goto bounces to /login.
  await expectSignedIn(page);

  await page.goto(userUrl);
  await page.getByRole("tab", { name: "Security" }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();

  await page.screenshot({ path: "test-results/2fa-admin-view.png", fullPage: true });

  await page.getByRole("button", { name: "Remove" }).click();
  const confirm = page.getByRole("dialog");
  await page.screenshot({ path: "test-results/2fa-confirm.png", fullPage: true });
  await expect(confirm).toContainText(/password alone/i);
  await confirm.getByRole("button", { name: "Remove two-factor" }).click();

  await expect(page.getByText(/Two-factor removed/i)).toBeVisible();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();

  // And it really is gone: they sign in with just their password, no challenge.
  await signOut(page);
  await page.waitForURL("**/login**");
  await page.getByLabel("Email or username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(ownPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Enter the 6-digit code/i)).toHaveCount(0);
  await expectSignedIn(page);
});
