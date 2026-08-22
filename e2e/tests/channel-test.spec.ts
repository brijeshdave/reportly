// Author: Brijesh Dave <https://github.com/brijeshdave>
// The button that proves email actually works.
//
// A whole-stack test is the only honest one here: the message goes through the
// real mailer to Mailpit, which is what makes the answer mean anything. An API
// test with a mocked mailer proves the wiring, not the delivery.
import { expect, test } from "@playwright/test";

test("sends a real test message and says what came back", async ({ page }) => {
  await page.goto("/settings?tab=channels");

  const card = page.getByRole("heading", { name: "Send a test message" }).locator("xpath=..");
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Send test" }).click();

  // Mailpit accepts it, so this is the happy answer — and it names where it went.
  await expect(card.getByText(/Sent to admin@reportly\.local/i)).toBeVisible();
});

test("writes the test into the message log like anything else", async ({ page }) => {
  await page.goto("/settings?tab=channels");
  const card = page.getByRole("heading", { name: "Send a test message" }).locator("xpath=..");
  await card.getByRole("button", { name: "Send test" }).click();
  await expect(card.getByText(/Sent to/i)).toBeVisible();

  await page.goto("/messages");
  // .first(): the spec above sent one too, and both are correctly logged.
  await expect(
    page.getByRole("row").filter({ hasText: "Reportly test message" }).first(),
  ).toBeVisible();
});
