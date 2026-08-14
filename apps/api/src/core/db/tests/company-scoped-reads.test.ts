// Author: Brijesh Dave <https://github.com/brijeshdave>
// The test SF-008 and SF-009 needed and did not have.
//
// Three cross-tenant holes were found by hand in a single afternoon, all the same
// shape: a service helper that fetches a row **by id alone** and then asks a
// visibility question that never mentions the company. The journal let a manager
// read another company's entry; tasks had it identically; the vocabulary let one
// company rename and delete another's tags, which is a write.
//
// None of the existing guards could see it. `scoped-callers.test.ts` checks
// *location* scoping, and `permission-coverage.test.ts` checks that permissions
// are enforced — a caller with a perfectly good `tags:manage` in their own company
// was exactly who exploited SF-009.
//
// So this reads the source and fails when a `require*(id)` helper takes no company
// and belongs to a feature whose rows have one. Blunt, like its neighbour, and for
// the same reason: it catches the mistake in code nobody has written yet.
//
// If this fails, do not delete the assertion. Either thread the company through,
// or add the helper below **with a reason somebody can disagree with**.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const featureDir = resolve(here, "../../../features");

/**
 * Helpers that legitimately fetch by id with no company, each for a stated reason.
 *
 * Two honest categories, and it is worth keeping them apart in your head:
 *
 *   - **Global resources.** The row has no `company_id` at all — roles, groups,
 *     severities, statuses, asset types, designations, companies themselves. There
 *     is nothing to scope to.
 *   - **Delegated visibility.** The helper deliberately answers "may you see this?"
 *     by asking the record it hangs off. Comments and attachments do this, which is
 *     why fixing the journal fixed all three at once — and equally why a hole in
 *     the journal was a hole in all three.
 */
const EXEMPT: Record<string, string> = {
  "journal-config/service.ts:requireSeverity": "severities are global — no company column",
  "journal-config/service.ts:requireStatus": "statuses are global — no company column",
  "journal-config/service.ts:requireCategory": "reached through its department, which is checked",
  "designations/service.ts:requireDesignation": "designations are global",
  "users/service.ts:requireUser": "a user is not a tenant row; access is checked per company",
  "companies/service.ts:requireCompany": "the company IS the tenant; membership is the check",
  "groups/service.ts:requireGroup": "groups are global and carry their own company list",
  "groups/service.ts:requireEditable": "as requireGroup",
  "roles/service.ts:requireRole": "roles are global",
  "roles/service.ts:requireEditable": "as requireRole",
  "assets/service.ts:requireType": "asset types are global — no company column",
  "queues/service.ts:requireQueue": "a queue is installation-wide, behind the server switch",
  "queues/service.ts:requireJob": "as requireQueue",
  "comments/service.ts:requireVisibleComment":
    "delegates to the owning record's visibility, which is company-checked",
};

/** Every `require*` helper in a feature service, and whether it takes a company. */
function helpers(): { key: string; takesCompany: boolean }[] {
  const found: { key: string; takesCompany: boolean }[] = [];
  for (const feature of readdirSync(featureDir, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;
    for (const file of readdirSync(resolve(featureDir, feature.name))) {
      if (!file.endsWith(".ts") || !file.includes("service")) continue;
      const source = readFileSync(resolve(featureDir, feature.name, file), "utf8");
      const re = /(?:async )?function (require[A-Z]\w*)\(([^)]*)\)/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(source))) {
        const [, name, params] = match;
        // A helper that takes no id at all is not the shape in question.
        if (!/\bid\s*:\s*string/.test(params!)) continue;
        found.push({
          key: `${feature.name}/${file}:${name}`,
          // `ctx` counts: an AuthContext carries the active company, and the
          // helpers that take one do check it.
          takesCompany: /companyId|ctx\s*:/.test(params!),
        });
      }
    }
  }
  return found;
}

describe("a row fetched by id is fetched for a company", () => {
  it("has no require-by-id helper that forgets the tenant", () => {
    const offenders = helpers()
      .filter((h) => !h.takesCompany && !(h.key in EXEMPT))
      .map((h) => h.key);

    expect(
      offenders,
      `These fetch a row by id with no company and no context, which is how SF-008 ` +
        `and SF-009 happened. Thread the company through, or add an exemption with ` +
        `a reason:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps its exemption list honest", () => {
    // An exemption for a helper that no longer exists is a comment pretending to
    // be a guard — and the next person reads it as coverage.
    const live = new Set(helpers().map((h) => h.key));
    const stale = Object.keys(EXEMPT).filter((key) => {
      const [file, name] = key.split(":");
      return ![...live].some((k) => k.endsWith(`${file!.split("/").pop()}:${name}`));
    });

    expect(stale, `Exemptions for helpers that no longer exist: ${stale.join(", ")}`).toEqual([]);
  });
});
