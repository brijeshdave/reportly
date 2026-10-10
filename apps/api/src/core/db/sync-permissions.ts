// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reconcile the permission catalogue with the registry, at boot.
//
// `role_permissions` points at `permissions` rows by id, so a permission that the
// code knows about and the table does not cannot be granted at all: the row it
// would reference is not there. Nothing says so, either — a save keeps the keys it
// can resolve and drops the rest, which `setRolePermissions` now refuses to do.
//
// The catalogue used to be written only by `cli seed`, which runs when a site is
// installed. Upgrades run migrations, so every permission added after a site went
// live never reached it: end-user access shipped, its five keys stayed missing on
// an installation that had been running since before it, and ticking them in a
// role appeared to work and did nothing. One site, one feature, a long time.
//
// So it is done on every start instead. The catalogue is derived from code, which
// makes code the only thing that can be out of step with it, and reconciling from
// code at the one moment every deployment passes through is both cheap and
// complete. Insert-only: a key the registry has dropped is left alone, because
// deleting it would cascade into whatever roles still grant it, and a stale row
// grants nothing on its own — `cli doctor` is where that gets reported.
import { ALL_PERMISSIONS } from "@reportly/shared";

import { db } from "@/core/db/index.js";
import { permissions } from "@/core/db/schema.js";

/** Insert any permission the registry has and the table does not. */
export async function syncPermissionCatalogue(): Promise<{ added: number }> {
  const before = await db.select({ key: permissions.key }).from(permissions);
  const known = new Set(before.map((row) => row.key));
  const missing = ALL_PERMISSIONS.filter((key) => !known.has(key));
  if (missing.length === 0) return { added: 0 };

  await db
    .insert(permissions)
    .values(missing.map((key) => ({ key })))
    // Two instances starting at once would otherwise race each other to the
    // unique index, and one of them would fail its boot over reference data.
    .onConflictDoNothing({ target: permissions.key });

  return { added: missing.length };
}
