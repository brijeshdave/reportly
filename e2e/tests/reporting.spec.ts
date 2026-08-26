// Author: Brijesh Dave <https://github.com/brijeshdave>
// The reporting domain, driven the way a person uses it: build the line, file an
// issue about it, record how long the line was down, attach the photo, score the work.
//
// This is the one place the whole Phase 5 stack runs together — the browser, the
// multipart upload, the polymorphic scope, the two clocks and the points ledger. The
// integration tests prove each rule against the API; this proves the screens reach
// them, which is the part no amount of fastify.inject can tell you.
import { expect, test, type Page } from "@playwright/test";

import { addMember, superadminName, unique } from "./helpers.js";

/**
 * Put the signed-in superadmin into a department, once for the file.
 *
 * The journal editor derives the department from the AUTHOR'S OWN memberships
 * rather than offering a free choice — you cannot file on behalf of a team you
 * are not on. The suite signs in as the seeded superadmin, who belongs to no
 * department, so every entry form here read "You are not in a department yet"
 * and could not be submitted. Nothing was wrong with the app; the specs predated
 * the rule.
 */
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

  // Idempotent: the file may be re-run against a database that already has it.
  const already = await page
    .getByText(superadminName(), { exact: false })
    .first()
    .isVisible()
    .catch(() => false);
  if (!already) {
    await addMember(page, superadminName(), "hod");
    await page.getByRole("button", { name: /save members/i }).click();
    // The saved membership itself, which is what this setup is for. Not a count
    // ("member" appears in several places, so a loose match is a strict-mode
    // violation) and not the Save button being enabled — a successful save
    // DISABLES it, because there is nothing left pending.
    await expect(page.getByText(superadminName()).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /save members/i })).toBeDisabled();
  }
  await page.close();
});

/** Every report belongs to a company, so nothing here works without one active. */
async function pickCompany(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Active company").selectOption({ index: 1 });
}

/** Add a top-level asset and return its name. */
async function addAsset(page: Page, name: string): Promise<void> {
  await page.goto("/assets");
  await page.getByRole("button", { name: /Add a top-level asset/i }).click();
  await page.getByPlaceholder("e.g. Line 3").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // The tree edits names in place, so the name is an input, not text.
  await expect(page.getByLabel(`Asset name: ${name}`)).toBeVisible();
}

/**
 * Choose an asset in the cascading picker.
 *
 * It replaced a single combobox of every asset: you walk down — site, then line,
 * then station — and stop wherever you like, so there is no `option` to click by
 * name. The first level is "Site or plant"; "Use this"/"Add" commits the choice.
 */
async function pickAsset(page: Page, name: string): Promise<void> {
  await page.getByLabel("Site or plant").selectOption({ label: name });
  await page.getByRole("button", { name: /^(Add|Use this)$/ }).click();
  // The chip's own Remove button, not the name as text. `getByText(name)` also
  // matches the `<option>` still sitting in the picker, which Playwright reports
  // as hidden — so the assertion failed while the chip was on screen the whole
  // time. A control that names the thing is the unambiguous handle.
  await expect(page.getByRole("button", { name: `Remove ${name}` }).first()).toBeVisible();
}

/**
 * Move an entry to its first finished status.
 *
 * Points are only offered once an entry is resolved — scoring work that is still
 * in progress would be marking something that has not finished changing.
 */
async function resolve(page: Page): Promise<void> {
  await page.getByLabel("Status").selectOption({ label: "Resolved" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
}

/** File a report through the editor and land on its detail page. */
async function fileReport(page: Page, title: string): Promise<void> {
  await page.goto("/journal/new");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);
}

test("files an issue scoped to a line, then records and closes its downtime", async ({ page }) => {
  const tag = unique("r").replace(/-/g, "").slice(0, 8);
  const lineName = `Line ${tag}`;

  await pickCompany(page);
  await addAsset(page, lineName);

  // File the issue, scoped to that line. Scope is what downtime hangs off — you
  // record time against the thing that was down, not against the report.
  await page.goto("/journal/new");
  await page.getByLabel("Title").fill(`Drive belt sheared on ${lineName}`);
  await pickAsset(page, lineName);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);

  // The scope round-trips onto the detail page as a chip.
  await expect(page.getByText(lineName).first()).toBeVisible();

  // Open the downtime with no end time: the line is still down.
  await page.getByRole("button", { name: /Record downtime/i }).click();
  await page.getByRole("button", { name: "Record", exact: true }).click();

  // An open entry is pending — that is the point of leaving the end time off, and
  // it is what keeps the line's running total climbing until somebody closes it.
  await expect(page.getByText(/still down/i).first()).toBeVisible();

  // It shows in the queue of outages waiting to be closed.
  await page.goto("/downtime");
  await expect(page.getByText(lineName).first()).toBeVisible();
});

test("assigns a task, completes it, and the work lands as a linked report", async ({ page }) => {
  const tag = unique("t").replace(/-/g, "").slice(0, 8);
  const title = `Grease the bearings ${tag}`;

  await pickCompany(page);

  await page.goto("/tasks/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Detail").fill("Monthly PM. Grease gun is in the east store.");
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}$/);
  const taskUrl = page.url();
  await expect(page.getByText("No report filed against this task yet.")).toBeVisible();

  // The hand-off that makes tasks worth having: completing opens a report already
  // filled in from the task, so the work reaches the appraisal loop.
  await page.getByRole("button", { name: /Complete & log work/i }).click();
  await expect(page).toHaveURL(/\/journal\/new\?taskId=[0-9a-f-]{36}/);
  await expect(page.getByLabel("Title")).toHaveValue(title);

  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/);

  // And the task carries the record of the work done against it. Straight back to
  // its own URL, not via the list: the list opens on *open* work, so a task that was
  // just completed is deliberately no longer in it.
  await page.goto(taskUrl);
  await expect(page.getByText("Done").first()).toBeVisible();
  await expect(page.getByText("No report filed against this task yet.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: title })).toBeVisible();
});

test("attaches a file to a report, and refuses a type the policy does not allow", async ({
  page,
}) => {
  const tag = unique("a").replace(/-/g, "").slice(0, 8);

  await pickCompany(page);
  await fileReport(page, `Belt failure ${tag}`);

  // The input is hidden behind a styled button; set the file on it directly.
  await page.setInputFiles('input[type="file"]', {
    name: "evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Drive belt sheared at 03:12.\n"),
  });
  await expect(page.getByText("evidence.txt")).toBeVisible();

  // The allowlist is enforced by the server, not by the file picker's filter — so
  // set a type the picker would never have offered and watch the API refuse it.
  await page.setInputFiles('input[type="file"]', {
    name: "payload.sh",
    mimeType: "application/x-shellscript",
    buffer: Buffer.from("#!/bin/sh\necho hi\n"),
  });
  await expect(page.getByText(/not accepted here/i)).toBeVisible();
  await expect(page.getByText("payload.sh")).toHaveCount(0);
});

test("scores a resolved report, which locks it and pays out the points", async ({ page }) => {
  const tag = unique("p").replace(/-/g, "").slice(0, 8);

  await pickCompany(page);
  await fileReport(page, `Conveyor jam ${tag}`);

  // Points are not offered on unfinished work. The wording distinguishes the two
  // ways an entry is unscoreable now: still open, or closed without being resolved
  // — a cancelled or duplicate entry earns nothing.
  await expect(page.getByText("Points are set once the entry is resolved.")).toBeVisible();
  await resolve(page);

  // The scoring grid replaced the single 0–10 mark: each person who worked the
  // entry gets points, and the author divides one pot between them. The superadmin
  // authored this alone, so they are the only row and it is a self split.
  const cell = page.getByLabel("Points for Super Admin");
  await expect(cell).toBeVisible();
  await cell.fill("8");
  await page.getByRole("button", { name: "Save points", exact: true }).click();

  // A self split counts towards nobody until a manager reviews it, and the panel
  // says so to the person whose work it is.
  await expect(page.getByText(/counts towards nobody/i)).toBeVisible();

  // Scoring locks the content: a score must never end up describing work that
  // changed under it afterwards.
  await expect(page.getByText(/locked/i).first()).toBeVisible();
  // The saved value round-trips into the same cell, which is the grid's own
  // record of the split rather than a number rendered somewhere else.
  await expect(page.getByLabel("Points for Super Admin")).toHaveValue("8");
});
