// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shared helpers for the e2e specs: the superadmin credentials saved by global
// setup, and a couple of small flows the specs repeat.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { E2E_SUPERADMIN_NAME } from "../config.js";

const here = dirname(fileURLToPath(import.meta.url));

export interface Creds {
  email: string;
  password: string;
}

/** The seeded superadmin's name — never a hardcoded one from somebody's own database. */
export function superadminName(): string {
  return E2E_SUPERADMIN_NAME;
}

/** The superadmin password global setup reset and logged in with. */
export function superadmin(): Creds {
  return JSON.parse(readFileSync(join(here, "..", ".auth", "creds.json"), "utf8")) as Creds;
}

/**
 * Sign in through the form, from a clean session.
 *
 * Deliberately does NOT wait to land in the app: it is also used where signing in
 * is *supposed* not to complete — a wrong password, or an account that answers
 * with a two-factor prompt. A caller that goes straight on to another page should
 * `await expectSignedIn(page)` first, or it races the redirect.
 */
export async function signIn(page: Page, creds: Creds): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(creds.email);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** A value unique enough that a test's fixtures never collide with a rerun. */
export function unique(prefix: string): string {
  // `randomUUID`, not `Math.random`. Nothing here is a secret — these are unique
  // names for throwaway rows — but the value flows into usernames, and a scanner
  // reading that taint cannot know the destination is a test database. Four
  // "insecure randomness" alerts on a public repository is four alerts somebody
  // has to triage before finding a real one, and the fix costs nothing.
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/**
 * The app's own sign-out, in the top bar. Scoped to the banner on purpose: the
 * Sessions card carries a "Sign out" per device, so an unscoped locator matches
 * several buttons that do quite different things.
 */
export function signOutButton(page: Page) {
  // `menuitem`, not `button`. The element IS a <button>, but it carries
  // role="menuitem" because it lives in a role="menu" — and an explicit role
  // replaces the implicit one, so getByRole("button") never matches it. That is
  // what made these specs hang: the element is on screen and visible, and the
  // locator waits for it forever.
  return page.getByRole("banner").getByRole("menuitem", { name: "Sign out" });
}

/**
 * Open the account menu. Sign out, Profile and the theme toggle moved behind it
 * when the top nav was reworked; they used to sit directly in the banner.
 */
export async function openAccountMenu(page: Page): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "Account menu" }).click();
}

/** Open the menu, then sign out. */
export async function signOut(page: Page): Promise<void> {
  await openAccountMenu(page);
  await signOutButton(page).click();
}

/**
 * Assert we are on a page that only a signed-in user can see.
 *
 * The account-menu trigger, not sign-out: the trigger is on every signed-in page,
 * while sign-out is one click inside a menu.
 */
export async function expectSignedIn(page: Page): Promise<void> {
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Account menu" }),
  ).toBeVisible();
}

/** The password an administrator sets when creating somebody. */
export const ADMIN_CHOSEN = "Adm1nChosen!Pass";
/** The password that person replaces it with, since the app insists they do. */
export const THEIR_OWN = "MyOwnP4ssword!ok";

export interface Person {
  id: string;
  name: string;
  username: string;
}

/**
 * Shut a multi-select's dropdown.
 *
 * It stays open after a choice — deliberately, so you can pick several — and it
 * renders into a portal with a full-screen backdrop over everything else. So the
 * Save button beneath is genuinely unclickable until the backdrop goes, which
 * reads in a failure as "the button is disabled" when it is not.
 *
 * A raw mouse click, not a locator: every locator on the page is covered by that
 * backdrop, and clicking the backdrop is exactly what a person does.
 */
export async function dismissPicker(page: Page): Promise<void> {
  await page.mouse.click(5, 5);
}

/**
 * Choose from a SearchableSelect — the type-to-search dropdown the department
 * pickers use.
 *
 * Not `selectOption`: this is a button and a portalled listbox, not a `<select>`,
 * because the options carry a second line (a department's parents, a person's
 * department, the company it is in) that a native option cannot render. The
 * trigger still answers to its label, so the only thing that changes for a caller
 * is opening it first.
 */
export async function pickFromCombo(page: Page, label: string, name: string): Promise<void> {
  await page.getByLabel(label, { exact: true }).click();
  // Addressed by the option's own name. Not the accessible name (the second line
  // joins it, so an exact match finds nothing) and not a text filter either — the
  // second line matches that, which is how "Engineering" once picked Backend,
  // whose parent is Engineering.
  await page.getByRole("listbox").locator(`[data-label="${name}"]`).first().click();
}

/**
 * A group carrying one role.
 *
 * The seed ships only Superadmin, because a group is an organisation's own idea of
 * a job — the roles are the app's vocabulary, the groups are the customer's. So a
 * test that needs a manager has to make one, exactly as an administrator would.
 */
export async function createGroup(page: Page, name: string, role: string): Promise<void> {
  await page.goto("/groups");
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  // "Create group", not /^create/i — the list's sortable "Created" column header
  // is a button too.
  // Creating opens the new group, so there is no list to come back through.
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await page.getByRole("tab", { name: "Roles" }).click();
  await page.getByRole("checkbox", { name: new RegExp(`^${role}`) }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
}

/**
 * Create somebody who can actually sign in and do the work: an account, a group
 * that carries the role, the company they act in, and a password of their own.
 *
 * All of it through the UI. The point of an end-to-end test is that the screens an
 * administrator uses really do add up to a working person — a fixture inserted
 * behind them would prove the opposite of what is being asked.
 */
export async function createPerson(
  page: Page,
  name: string,
  username: string,
  group: string,
): Promise<Person> {
  await page.goto("/users/new");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(`${username}@reportly.test`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Set a password now").check();
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_CHOSEN);
  await page.getByRole("button", { name: "Create user" }).click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}/);
  const id = page.url().split("/").pop()!.split("?")[0]!;

  await page.goto(`/users/${id}?tab=groups`);
  // Exact: "Save groups" also contains "Groups", and the control and its save
  // button are a click apart.
  await page.getByRole("button", { name: "Groups", exact: true }).click();
  await page.getByRole("option", { name: group }).click();
  await dismissPicker(page);
  await page.getByRole("button", { name: "Save groups" }).click();

  // Companies are assigned separately from groups, and deliberately: a group says
  // what somebody may do, a company says where.
  await page.goto(`/users/${id}?tab=scope`);
  await page.getByRole("button", { name: "Companies", exact: true }).click();
  // Scoped to the listbox: the topbar's company switcher is a native <select>, so
  // a bare `option` finds "All companies" up there instead.
  await page.getByRole("listbox").getByRole("option").first().click();
  await dismissPicker(page);
  await page.getByRole("button", { name: "Save scope" }).click();

  return { id, name, username };
}

/** Sign in as somebody, replacing the administrator's password on the way through. */
export async function signInAs(page: Page, person: Person, firstTime = true): Promise<void> {
  // Signing out redirects to /login itself. Navigating there at the same moment
  // aborts that redirect mid-flight, which surfaces as ERR_ABORTED rather than as
  // anything to do with signing in — so wait for it, and only go there if the
  // caller was somewhere else entirely.
  await page.waitForURL("**/login**", { timeout: 5000 }).catch(async () => {
    await page.goto("/login");
  });
  await page.getByLabel("Email or username").fill(person.username);
  await page.getByLabel("Password", { exact: true }).fill(firstTime ? ADMIN_CHOSEN : THEIR_OWN);
  await page.getByRole("button", { name: "Sign in" }).click();

  if (!firstTime) return;

  // An administrator-chosen password is not one to leave standing, so the app
  // holds them here until they replace it.
  await page.waitForURL("**/profile**");
  await page.goto("/profile?tab=security");
  await changePassword(page, ADMIN_CHOSEN, THEIR_OWN);
}

/**
 * Replace a password, waiting out the throttle if we hit it.
 *
 * better-auth ships a built-in rule that no configuration of ours overrides:
 * `/change-password` allows three attempts per ten seconds, per address. That is
 * a sensible protection and not something to weaken — but a spec that sets up
 * three people does three password changes inside a second, which no human does,
 * and the third is refused.
 *
 * So this waits for the window and tries again rather than the app being loosened
 * to suit the test. Twice is enough: three specs' worth of people at a time.
 *
 * And it asks for a longer budget, because waiting the window out honestly costs
 * more than the default thirty seconds a test gets: two refusals are two eleven
 * second waits plus their polls. Locally the throttle rarely trips and this never
 * shows; on CI, where every spec shares one address, it trips and the test died
 * of its own patience.
 */
export async function changePassword(page: Page, from: string, to: string): Promise<void> {
  test.slow();
  const throttled = page.getByRole("alert").filter({ hasText: /too many requests/i });
  const gate = page.getByRole("alert").filter({ hasText: /password needs changing/i });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel("Current password").fill(from);
    await page.getByLabel("New password", { exact: true }).fill(to);
    await page.getByLabel("Confirm new password").fill(to);
    await page.getByRole("button", { name: /change password/i }).click();

    // Wait for an actual outcome. Counting alerts straight after the click reads
    // the page before the response lands, so it always looked like success — and
    // then the assertion below failed on a page that had been refused.
    await expect
      .poll(async () => (await throttled.count()) > 0 || (await gate.count()) === 0, {
        timeout: 10_000,
      })
      .toBe(true);

    if ((await throttled.count()) === 0) break;
    // The window is ten seconds; wait it out and let the form settle.
    await page.waitForTimeout(11_000);
    await page.reload();
  }

  // The gate lifts only once the password is genuinely theirs — wait for it, or
  // everything after this is a 403 and every assertion a lie.
  await expect(gate).toHaveCount(0);
}

/**
 * Reveal a sidebar link by opening the group that holds it.
 *
 * The sidebar groups fold, and they start folded — only the first group, and
 * whichever one holds the current page, are open. So a link in any other group is
 * genuinely not in the DOM, and a locator waiting for it waits forever.
 *
 * Idempotent: a group that is already open is left alone, which matters because
 * the open set is remembered in localStorage, so the second link in a group
 * needs no second click.
 */
export async function openNavGroup(page: Page, group: string): Promise<void> {
  const header = page.getByRole("button", { name: group, exact: true });
  if ((await header.getAttribute("aria-expanded")) === "false") await header.click();
}

/**
 * Add somebody to the open department, and set their place in the line.
 *
 * People are searched for and clicked, not ticked from a list of everyone: past a
 * few dozen staff a checkbox per person is unusable, so the page went to a
 * search-to-add box. Two specs drive this, so it lives here — when the screen
 * changes again, it changes in one place rather than rotting in two.
 */
export async function addMember(
  page: Page,
  name: string,
  rank: "hod" | "lead" | "member",
  reportsTo?: string,
): Promise<void> {
  await page.getByLabel("Add a person").fill(name);
  // The search needs more than one character before it will look.
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByLabel(`Rank: ${name}`).selectOption(rank);
  // "Reports to" is a searchable dropdown rather than a `<select>` — a department
  // of forty is forty entries to scroll past, and the name is the thing you know.
  if (reportsTo) await pickFromCombo(page, `Reports to: ${name}`, reportsTo);
}
