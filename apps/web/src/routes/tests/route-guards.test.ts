// Author: Brijesh Dave <https://github.com/brijeshdave>
// A page's guard must not be stricter than the route behind it.
//
// Reported from use: "create-own permission is given to the user but still when
// they access the page by clicking create task, it says not authorized."
//
// That is a drift bug of the family this codebase keeps finding: three places
// decide who may create a task — the API route, the button on the list, and the
// router's own `beforeLoad` — and only the third disagreed. Nothing connected
// them, so the two that were right made the one that was wrong *harder* to spot:
// the button appeared, which is exactly what tells somebody they are allowed.
//
// A typecheck cannot see it. Both sides are valid code; they simply say different
// things.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const routerSource = readFileSync(resolve(here, "../router.tsx"), "utf8");
const taskRoutes = readFileSync(
  resolve(here, "../../../../api/src/features/tasks/routes.ts"),
  "utf8",
);

/** The `beforeLoad` line of the route declared at `path`. */
function guardFor(path: string): string {
  const at = routerSource.indexOf(`path: "${path}"`);
  expect(at, `no route declared at ${path}`).toBeGreaterThan(-1);
  const after = routerSource.slice(at, at + 600);
  const guard = /beforeLoad:\s*([\s\S]*?),\n\s{2}component/.exec(after);
  expect(guard, `no beforeLoad on ${path}`).not.toBeNull();
  return guard![1]!;
}

describe("the router's guards agree with the API", () => {
  it("opens the new-task page to either grant that may create one", () => {
    // The API has always accepted both. Read from its source rather than restated
    // here, so this test fails if somebody narrows that side instead.
    expect(taskRoutes).toContain(
      "app.requireAnyPermission([PERMISSIONS.TASKS_CREATE, PERMISSIONS.TASKS_CREATE_OWN])",
    );

    const guard = guardFor("/tasks/new");
    expect(guard).toContain("TASKS_CREATE_OWN");
    expect(guard).toContain("TASKS_CREATE");
  });

  it("does not let a single-permission guard front a route that accepts several", () => {
    // The shape of the bug rather than the one instance of it: a `beforeLoad` that
    // names one permission in front of an API route accepting a list is a page
    // somebody is told they may use and then refused by.
    const guard = guardFor("/tasks/new");
    expect(guard.startsWith("requirePermission(")).toBe(false);
  });
});
