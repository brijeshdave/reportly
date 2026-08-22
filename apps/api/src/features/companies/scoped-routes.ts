// Author: Brijesh Dave <https://github.com/brijeshdave>
// Which routes carry a company's own work — the ones a deactivated company closes.
//
// Deliberately a list rather than "every route that happens to carry the company
// header". The web app sends `x-company-id` on **every** request, so treating the
// header alone as the trigger refuses far more than it should: editing a user,
// changing a setting — and, fatally, `POST /companies/:id/reactivate`, which would
// leave a deactivated company with no way back on. A guard that locks the door and
// posts the key inside is worse than no guard.
//
// `scoped-routes.test.ts` fails the build when a feature reads `ctx.companyId` and
// none of its prefixes appear here, so a new company-scoped feature cannot quietly
// escape the rule the way this one did.

/**
 * Path prefixes (after `/api/v1`) whose rows belong to one company.
 *
 * Not here on purpose:
 * - `/users`, `/groups`, `/roles`, `/settings` — people and configuration outlive
 *   any one company, and an administrator must be able to work on them whichever
 *   company happens to be selected in the switcher.
 * - `/companies` — the way back on. See above.
 * - `/me`, `/analytics`, `/insights`, `/logs`, `/audit` — reading, marking your own
 *   notifications read, and reporting on what already exists. Deactivating stops a
 *   company accruing work; it does not stop people looking at it.
 */
export const COMPANY_OWNED_PREFIXES = [
  "/asset-types",
  "/assets",
  "/categories",
  "/comments",
  "/consumables",
  "/departments",
  "/device-types",
  "/devices",
  "/downtime",
  "/journal",
  "/journal-config",
  "/journal-statuses",
  "/locations",
  "/part-models",
  "/part-service-kinds",
  "/parts",
  "/points",
  "/report-views",
  "/reports",
  "/routines",
  "/schedules",
  "/severities",
  "/shifts",
  "/swaps",
  "/tags",
  "/tasks",
] as const;

/** True when this path is one company's own work rather than the app's furniture. */
export function isCompanyOwnedPath(path: string): boolean {
  return COMPANY_OWNED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
