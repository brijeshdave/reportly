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

test("shows a message under every work-done field", async ({ page }) => {
  // Reported from use: "no proper errors or some times no errors shown for work done
  // on front end." The work fields were validated and not drawn, so the submit
  // stopped and said nothing at all.
  await pickCompany(page);
  await page.goto("/journal/new");
  await expect(page.getByLabel("Title")).toBeVisible();
  await page.getByLabel("Title").fill(`Belt snapped ${unique("w").slice(0, 6)}`);

  // Everything the issue needs, so the only thing left wrong is the work.
  await page.getByLabel("Severity").selectOption({ index: 1 });
  await page.getByLabel("What happened (short)").fill("It stopped mid-run");
  await page.getByLabel("Detailed description").fill("Came to a halt under load.");
  await page.getByLabel("Occurred at").fill(nowMinus(30));

  // Claim work, then say nothing else about it.
  await page.getByLabel("I already did the work").check();
  await page.getByLabel("Summary").fill("Replaced the drive belt");
  await page.getByRole("button", { name: "Submit", exact: true }).click();

  await expect(page.getByText(/Describe what you did/)).toBeVisible();
  await expect(page.getByText("Say when you started.")).toBeVisible();
  await expect(page.getByText("Say when you finished.")).toBeVisible();
  await expect(page).toHaveURL(/\/journal\/new$/);
  await page.screenshot({ path: "test-results/work-done-errors.png", fullPage: true });
});

test("asks for the findings when resolving, and will not commit without them", async ({ page }) => {
  // Set up through the API: this test is about the panel, not about filling a form
  // that other tests already cover.
  await pickCompany(page);
  const companyId = await page.evaluate(() => localStorage.getItem("reportly.companyId"));
  const headers = { "x-company-id": companyId! };
  const severities = await (await page.request.get("/api/v1/severities")).json();
  const depts = await (await page.request.get("/api/v1/me/departments", { headers })).json();
  const sites = await (await page.request.get("/api/v1/me/locations", { headers })).json();

  const filed = await page.request.post("/api/v1/journal", {
    headers,
    data: {
      kind: "issue",
      title: `Belt snapped ${unique("r").slice(0, 6)}`,
      state: "submitted",
      severityId: severities[3].id,
      departmentId: depts[0]?.departmentId,
      locationId: sites[0].id,
      issueSummary: "It stopped mid-run",
      issueDetail: "Came to a halt under load and would not restart.",
      occurredAt: new Date(Date.now() - 600_000).toISOString(),
    },
  });
  expect(filed.status(), await filed.text()).toBe(201);
  const id = (await filed.json()).id as string;

  await page.request.post(`/api/v1/journal/${id}/work`, {
    headers,
    data: {
      summary: "Replaced the drive belt",
      detail: "Spare from the east store, ran it up afterwards.",
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      finishedAt: new Date(Date.now() - 60_000).toISOString(),
    },
  });

  await page.goto(`/journal/${id}`);
  await page.getByLabel("Status").selectOption({ label: "Resolved" });

  // The fields appear at the moment they are due, and the commit sits under them.
  await expect(page.getByLabel("Root cause")).toBeVisible();
  await expect(page.getByLabel("Preventive measures")).toBeVisible();
  const resolve = page.getByRole("button", { name: "Resolve", exact: true });
  await expect(resolve).toBeDisabled();

  await page.getByLabel("Root cause").fill("The tensioner had backed off.");
  await page.getByLabel("Preventive measures").fill("Added it to the weekly round.");
  await expect(resolve).toBeEnabled();
  await resolve.click();

  // And the entry is finished, with the findings on it.
  await expect(page.getByText("The tensioner had backed off.").first()).toBeVisible();
});

/** A `datetime-local` value, that many minutes ago. */
function nowMinus(minutes: number): string {
  const d = new Date(Date.now() - minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
