// Author: Brijesh Dave <https://github.com/brijeshdave>
// Authentication end to end: the credential form, a bad password, sign-out, and
// the full two-factor round trip — enrol, sign out, sign back in with a TOTP code
// this test computes itself. 2FA is the one flow unit tests can only approximate,
// because it spans two sign-ins and a real time-based code.
import { expect, test } from "@playwright/test";

import { expectSignedIn, signIn, signOut, superadmin } from "./helpers.js";
import { secretFromOtpauthUri, totp } from "./totp.js";

// These specs manage their own session, so they start signed out.
test.use({ storageState: { cookies: [], origins: [] } });

test("rejects a wrong password without saying which field was wrong", async ({ page }) => {
  await signIn(page, { email: superadmin().email, password: "definitely-not-the-password" });
  await expect(page.getByRole("alert")).toContainText(/invalid email or password/i);
  await expect(page).toHaveURL(/\/login/);
});

test("signs in with the right password and back out again", async ({ page }) => {
  await signIn(page, superadmin());
  await expectSignedIn(page);

  await signOut(page);
  await expect(page).toHaveURL(/\/login/);
});

test("enrols in two-factor, then requires a code on the next sign-in", async ({ page }) => {
  const creds = superadmin();

  await signIn(page, creds);
  await expectSignedIn(page);

  // Enrol from Your account → Security. The two-factor card is scoped explicitly
  // because the change-password card on the same page also has a "Current
  // password" field, and each enrolment step has a unique heading to anchor to.
  await page.goto("/profile?tab=security");
  const card = page.locator("form,section,div").filter({ hasText: "Two-factor authentication" });

  await page.getByRole("button", { name: "Set up two-factor" }).click();
  const passwordStep = page.locator("form").filter({ hasText: "Confirm your password to start" });
  await passwordStep.getByLabel("Current password").fill(creds.password);
  await passwordStep.getByRole("button", { name: "Continue" }).click();

  // The setup key is shown so a person can type it into an app; we read it the same way.
  const setupKey = (await page.locator("code").first().innerText()).trim();
  const secret = setupKey.includes("otpauth://") ? secretFromOtpauthUri(setupKey) : setupKey;

  await page.getByLabel(/I have saved these codes/i).check();
  // "Authentication code" is unique to the enrolment step, so no scoping needed.
  await page.getByLabel("Authentication code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(card.getByText("On", { exact: true })).toBeVisible();

  // Sign out, and prove the account now demands the second factor.
  await signOut(page);
  await expect(page).toHaveURL(/\/login/);

  await signIn(page, creds);
  await expect(page.getByText(/Enter the 6-digit code/i)).toBeVisible();
  await page.getByLabel(/Authentication code/i).fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();

  // Straight in, with no detour through the login screen. Reported from use: after
  // a correct code the login page reappeared for a second or two before the
  // dashboard, which reads as the code having failed. The session existed the whole
  // time — the page navigated before its own session query had caught up, so the
  // guard on the destination bounced it back here.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5000 });
  await expectSignedIn(page);

  // Leave the account as we found it, so a rerun starts from a clean state.
  await page.goto("/profile?tab=security");
  await page.getByRole("button", { name: "Turn off two-factor" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Current password").fill(creds.password);
  await dialog
    .getByRole("button", { name: /turn off|disable|confirm/i })
    .last()
    .click();
  await expect(card.getByText("Off", { exact: true })).toBeVisible();
});
