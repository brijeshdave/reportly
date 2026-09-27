// Author: Brijesh Dave <https://github.com/brijeshdave>
// What a submitted issue must say, and when it may be closed — on the screen.
//
// Reported from use: "Severity, Status, What happened (short), Detailed description,
// Occurred at should be required fields", "any journal must not allow directly with
// status that are like resolved", and "at resolving time it should only allow if Root
// cause and Preventive measures are filled... not allow the users directly fill this
// fields at time of creating journal".
//
// The API tests prove each rule. This proves a person meets them where they are
// working: messages under the inputs they belong to rather than one sentence above
// the form, a status list that cannot file something finished, and the findings asked
// for at the moment they are due.
import { expect, test, type Page } from "@playwright/test";

import { addMember, superadminName, unique } from "./helpers.js";

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("/departments");
  await page.getByLabel("Active company").selectOption({ index: 1 });
  await page
    .getByRole("link", { name: /Engineering/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);
  await page.getByRole("tab", { name: /members/i }).click();
  const already = await page
    .getByText(superadminName(), { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (!already) {
    await addMember(page, superadminName(), "hod");
    await page.getByRole("button", { name: /save members/i }).click();
    await expect(page.getByRole("button", { name: /save members/i })).toBeDisabled();
  }
  await page.close();
});

async function pickCompany(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Active company").selectOption({ index: 1 });
}

test("puts each missing field's message under that field, and never leaves the form", async ({
  page,
}) => {
  await pickCompany(page);
  await page.goto("/journal/new");
  await page.getByLabel("Title").fill(`Something stopped ${unique("v").slice(0, 6)}`);

  await page.getByRole("button", { name: "Submit", exact: true }).click();

  // The complaint, answered: not a sentence above the form, but a line under each
  // input that is missing something.
  await expect(
    page.getByText("Choose a severity — it decides what the entry is worth."),
  ).toBeVisible();
  await expect(page.getByText("Say what happened, in a line.")).toBeVisible();
  await expect(page.getByText(/Describe what happened/)).toBeVisible();
  await expect(page.getByText("Say when it happened.")).toBeVisible();

  // Nothing was sent: the browser checks against the schema the API parses with, so a
  // form it knows will be refused does not make the round trip at all.
  await expect(page).toHaveURL(/\/journal\/new$/);
  await expect(page.getByLabel("Severity")).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({ path: "test-results/journal-required-fields.png", fullPage: true });
});

test("offers no finished status when filing, and no root cause to guess at", async ({ page }) => {
  await pickCompany(page);
  await page.goto("/journal/new");
  // The editor loads its severities, statuses and categories before it draws; reading
  // the options while the spinner is still up finds an empty list and proves nothing.
  await expect(page.getByLabel("Title")).toBeVisible();
  await expect(page.getByLabel("Status").locator("option").first()).toBeAttached();

  // An issue enters the workflow at the start of it. Filing at the end skips triage
  // and leaves a history that begins where it should stop.
  const statuses = await page.getByLabel("Status").locator("option").allTextContents();
  expect(statuses.length).toBeGreaterThan(0);
  expect(statuses.join("|")).not.toMatch(/resolved|duplicate|cancelled|rejected/i);

  // And the findings are not asked for before anybody has looked at the machine.
  await expect(page.getByLabel("Root cause")).toBeHidden();
  await expect(page.getByLabel("Preventive measures")).toBeHidden();
});
