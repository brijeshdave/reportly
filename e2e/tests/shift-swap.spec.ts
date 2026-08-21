// Author: Brijesh Dave <https://github.com/brijeshdave>
// A roster built, published, and then changed by the people on it: one person asks
// to swap a shift with a colleague, and their manager decides.
//
// Three people again, because a swap is not observable from one seat — the
// requester picks only from their own cells, the counterpart is somebody else's
// day, and only the reporting manager may approve. The API tests cover the rules;
// this covers whether the screens actually let anyone reach them.
import { expect, test } from "@playwright/test";

import {
  addMember,
  createGroup,
  createPerson,
  expectSignedIn,
  pickFromCombo,
  signIn,
  signInAs,
  signOut,
  superadmin,
  unique,
} from "./helpers.js";

// Signs people in and out, so it takes its own session rather than revoking the
// one the rest of the suite shares.
test.use({ storageState: { cookies: [], origins: [] } });

test("a colleague swap is requested and approved", async ({ page }) => {
  const tag = unique("sw").replace(/-/g, "").slice(0, 6);
  const managerName = `Priya ${tag}`;
  const askerName = `Dev ${tag}`;
  const mateName = `Kiran ${tag}`;

  await signIn(page, superadmin());
  await expectSignedIn(page);
  await page.getByLabel("Active company").selectOption({ index: 1 });

  const managerGroup = `Shift managers ${tag}`;
  const staffGroup = `Shift staff ${tag}`;
  await createGroup(page, managerGroup, "Manager");
  await createGroup(page, staffGroup, "Member");

  const manager = await createPerson(page, managerName, `priya${tag}`, managerGroup);
  const asker = await createPerson(page, askerName, `dev${tag}`, staffGroup);
  await createPerson(page, mateName, `kiran${tag}`, staffGroup);

  // --- the department, with both staff reporting to the manager ---
  await page.goto("/departments");
  await page.getByRole("button", { name: /new department/i }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Packing ${tag}`);
  await page.getByRole("button", { name: /create department/i }).click();
  await expect(page).toHaveURL(/\/departments\/[0-9a-f-]{36}/);
  await addMember(page, managerName, "hod");
  await addMember(page, askerName, "member", managerName);
  await addMember(page, mateName, "member", managerName);
  await page.getByRole("button", { name: /save members/i }).click();
  await expect(page.getByText(/3 members/)).toBeVisible();

  // --- a shift to put people on ---
  await page.goto("/shifts");
  await page.getByRole("button", { name: /new shift|add shift/i }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Morning ${tag}`);
  await page.getByLabel("Code").fill("M");
  await page.getByRole("button", { name: "Create shift" }).click();

  // --- the roster: both of them on the same day, then published ---
  await page.goto("/schedule");
  await pickFromCombo(page, "Department", `Packing ${tag}`);
  // A rota is a department *at a site*, so the site is part of choosing which one.
  // These two are placed at no site in particular, which means all of them, so they
  // are on this one's roster.
  await page.getByLabel("Site").click();
  await page.getByRole("listbox").getByRole("option").first().click();

  // A month has no roster until somebody starts one — the page offers a blank or a
  // carry-forward rather than inventing one.
  await page.getByRole("button", { name: "Start blank" }).click();

  // The cells are named "<person>, <date>", which is what makes one addressable at
  // all — before that every cell was an unnamed button holding a one-letter code.
  // Both people on the same day, so there is something to swap.
  const putOnShift = async (who: string) => {
    const cell = page.getByRole("button", { name: new RegExp(`^${who}, `) }).first();
    await cell.click();
    // The toolbar only exists while a cell is selected, and it goes again as soon
    // as a shift is chosen — so wait for it rather than assume it is still there
    // from the person before. Each shift is its own button now, in its own colour;
    // it used to be a "Set shift…" dropdown.
    const setShift = page.getByRole("button", { name: "M", exact: true });
    await expect(setShift).toBeVisible();
    await setShift.click();
    // And wait for the code to land in the cell. Setting a shift re-renders the
    // whole grid, so clicking the next person immediately hits a node that is on
    // its way out and selects nothing.
    await expect(cell).toHaveText("M");
  };
  await putOnShift(askerName);
  await putOnShift(mateName);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published")).toBeVisible();

  await signOut(page);

  // --- one of them asks to swap ---
  await signInAs(page, asker);
  await page.goto("/schedule/changes/new");
  await page.getByLabel("Which shift?").selectOption({ index: 1 });
  await page.getByLabel("Suggest swapping with (optional)").selectOption({ index: 1 });
  await page.getByLabel("Note (optional)").fill("Hospital appointment.");
  await page.getByRole("button", { name: "Send request" }).click();

  // The page opens on "To decide", which is a manager's list — the person who
  // asked has to look under their own requests.
  await page.goto("/schedule/changes");
  await page.getByRole("button", { name: "My requests" }).click();
  await expect(page.getByText("Hospital appointment.")).toBeVisible();

  await signOut(page);

  // --- their manager decides it ---
  await signInAs(page, manager);
  await page.goto("/schedule/changes");
  await page.getByRole("button", { name: "To decide" }).click();
  await expect(page.getByText(askerName).first()).toBeVisible();

  // A suggestion is not a decision: the manager chooses how to resolve it — swap
  // with the named colleague, or take the person off entirely — and Approve stays
  // disabled until they have. Picking the suggested colleague is the common case.
  // index 1 is the first real choice — index 0 is the "Choose how to resolve…"
  // placeholder, and selectOption takes no regex.
  await page.getByLabel("Resolve by").first().selectOption({ index: 1 });
  await page.getByRole("button", { name: "Approve" }).first().click();

  // Decided: it leaves the manager's queue, and stands as approved on the
  // requester's own list rather than merely disappearing.
  await expect(page.getByText("Hospital appointment.")).toHaveCount(0);
  await page.getByRole("button", { name: "Decided by me" }).click();
  await expect(page.getByText(askerName).first()).toBeVisible();
});
