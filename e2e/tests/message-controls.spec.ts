// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning self-service password reset off, from the screen that does it.
//
// The behaviour that only a browser proves: the link disappears from the login
// page. An API test can show the endpoint refusing; it cannot show that nobody is
// invited to press a button that will refuse them.
import { expect, test } from "@playwright/test";

test("hides the forgot-password link when an administrator handles resets", async ({
  page,
  browser,
}) => {
  await page.goto("/settings?tab=auth");

  // Each setting is a card headed `namespace.key`, so that heading is the anchor
  // and its parent is the card. Filtering divs by visible text instead happily
  // matches an outer container that holds no control at all.
  const card = page.getByRole("heading", { name: "auth.passwordReset" }).locator("xpath=..");
  await card.getByLabel("Allow self service").uncheck();
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText(/Saved/i)).toBeVisible();

  const signedOut = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const theirPage = await signedOut.newPage();
  await theirPage.goto("/login");
  await expect(theirPage.getByLabel("Email")).toBeVisible();
  await expect(theirPage.getByRole("link", { name: /Forgot your password/i })).toHaveCount(0);
  await signedOut.close();

  // Put it back, so the rest of the suite runs against the normal login screen.
  await card.getByLabel("Allow self service").check();
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByText(/Saved/i)).toBeVisible();
});
