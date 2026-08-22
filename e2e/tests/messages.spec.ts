// Author: Brijesh Dave <https://github.com/brijeshdave>
// The record of what left the building.
//
// Only a whole stack shows this one honestly: an invitation is sent, goes through
// the queue to Mailpit, and has to appear in the log as an invitation — with the
// address part-hidden, because the row never held the whole of it.
import { expect, test } from "@playwright/test";

import { unique } from "./helpers.js";

test("logs what was sent, to whom, and how it went", async ({ page }) => {
  const username = unique("invited");
  const email = `${username}@reportly.test`;

  await page.goto("/users");
  await page.getByRole("button", { name: "Invite" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Invited Person");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(dialog.getByText(/Invitation sent to/i)).toBeVisible();

  await page.goto("/messages");
  const row = page.getByRole("row").filter({ hasText: "Invited Person" });
  await expect(row).toBeVisible();

  // An invitation, not a password reset — the two share a mechanism, and telling
  // them apart is the whole reason the log can answer "did their invite go out?".
  await expect(row.getByText("Invite", { exact: true })).toBeVisible();

  // Part-hidden: the row never held the address, so no screen can reveal it.
  await expect(row.getByText(`${email[0]}•••@reportly.test`)).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);

  // And it says what it is. An invited person has no password to *re*set, so the
  // subject the log shows is the invitation's own, not the reset template's.
  await expect(row.getByText("You have been invited to Reportly")).toBeVisible();
});
