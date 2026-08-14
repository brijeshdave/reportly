// Author: Brijesh Dave <https://github.com/brijeshdave>
// Navigation is permission-gated: the sidebar only offers what can() allows, and a
// guarded route bounces anyone without a session. The superadmin sees everything,
// so this checks each section is reachable; and a signed-out visit to a guarded
// route redirects to login rather than rendering it.
import { expect, test } from "@playwright/test";

import { openNavGroup } from "./helpers.js";

// The group each link sits in. The sidebar folds, and starts folded, so a link in
// a shut group is not in the DOM at all — which is exactly what a person hits, and
// therefore what this has to walk through rather than around.
const SECTIONS = [
  { group: "Organisation", link: "Companies", heading: /companies/i, path: /\/companies/ },
  { group: "People & access", link: "Users", heading: /users/i, path: /\/users/ },
  { group: "People & access", link: "Groups", heading: /groups/i, path: /\/groups/ },
  { group: "People & access", link: "Roles", heading: /roles/i, path: /\/roles/ },
  { group: "System", link: "Settings", heading: /settings/i, path: /\/settings/ },
  { group: "System", link: "Logs", heading: /logs/i, path: /\/logs/ },
  { group: "System", link: "Audit", heading: /audit/i, path: /\/audit/ },
];

test("the superadmin can open every gated section from the sidebar", async ({ page }) => {
  await page.goto("/");
  for (const section of SECTIONS) {
    await openNavGroup(page, section.group);
    await page.getByRole("link", { name: section.link, exact: true }).click();
    await expect(page).toHaveURL(section.path);
    await expect(page.getByRole("heading", { name: section.heading }).first()).toBeVisible();
  }
});

test.describe("without a session", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guarded route redirects to login instead of rendering", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
