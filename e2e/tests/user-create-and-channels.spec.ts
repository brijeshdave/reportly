// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating a user the way an admin does, then that person signing in and proving
// their email — the whole path through the real UI: create with a password, sign
// in by *username*, get held at the change-password gate, replace the password,
// then verify the email with the code that actually arrives in the mailbox.
import { expect, test } from "@playwright/test";

import { changePassword, expectSignedIn, signIn, signOut, superadmin, unique } from "./helpers.js";

/**
 * Its own session, because it signs out.
 *
 * Signing out revokes that session on the server, and the shared storage state
 * every other spec loads points at the same token — so borrowing it here would
 * leave whatever runs next unauthenticated. It only passed before by sorting last.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const ADMIN_CHOSEN = "Adm1nChosen!Pass";
const THEIR_OWN = "MyOwnP4ssword!ok";

/**
 * The 6-digit code from the message sent to `email`, read out of Mailpit.
 *
 * Polled, not read once: the code is queued and delivered by the mail worker, so
 * it reaches the mailbox a moment after the request returns. That asynchrony is
 * the design, not a flake — the test waits for it like a person would.
 */
async function codeSentTo(email: string): Promise<string> {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    const { messages } = (await (
      await fetch("http://localhost:8025/api/v1/messages?limit=200")
    ).json()) as { messages: { ID: string; To: { Address: string }[] }[] };

    const hit = messages.find((m) => (m.To ?? []).some((t) => t.Address === email));
    if (hit) {
      const full = (await (
        await fetch(`http://localhost:8025/api/v1/message/${hit.ID}`)
      ).json()) as { Text?: string; HTML?: string };
      const match = (full.Text ?? full.HTML ?? "").match(/\b(\d{6})\b/);
      expect(match, "the email carried no verification code").toBeTruthy();
      return match![1]!;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`no email reached ${email} within 20s`);
}

test("creates a user, signs in by username, and verifies their email", async ({ page }) => {
  const username = unique("ada").replace(/-/g, "").slice(0, 20).toLowerCase();
  const email = `${username}@reportly.test`;

  // --- an administrator creates the account outright ---
  await signIn(page, superadmin());
  await expectSignedIn(page);
  await page.goto("/users/new");
  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(email);

  // The login name is suggested from the address, but stays the admin's to choose.
  await expect(page.getByLabel("Username")).not.toHaveValue("");
  await page.getByLabel("Username").fill(username);

  await page.getByLabel("Set a password now").check();
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_CHOSEN);
  await page.getByLabel("Mobile").fill("+919876543210");
  await page.getByLabel("WhatsApp").check();
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}/);

  // --- that person signs in, with their username rather than their email ---
  await signOut(page);
  await page.waitForURL("**/login**");
  await page.getByLabel("Email or username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_CHOSEN);
  await page.getByRole("button", { name: "Sign in" }).click();

  // A password their administrator chose is not one to leave standing: they are
  // held at the change-password screen and cannot reach the rest of the app.
  await page.waitForURL("**/profile**");
  await expect(page.getByRole("alert").first()).toContainText(/password needs changing/i);
  await page.goto("/users");
  await expect(page).toHaveURL(/\/profile/);

  await page.goto("/profile?tab=security");
  await changePassword(page, ADMIN_CHOSEN, THEIR_OWN);

  // --- with a password of their own, they can prove their email ---
  await page.goto("/profile?tab=channels");
  // The Verify button only renders once the channel list has actually loaded.
  await expect(page.getByRole("button", { name: "Verify" }).first()).toBeVisible();

  // No SMS provider is configured, so the mobile says so rather than offering a
  // button that could not deliver.
  await expect(page.getByText("Unavailable").first()).toBeVisible();

  await page.getByRole("button", { name: "Verify" }).first().click();
  await page.getByLabel("Code").fill(await codeSentTo(email));
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByText("Verified").first()).toBeVisible();
});
