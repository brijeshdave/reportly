// Author: Brijesh Dave <https://github.com/brijeshdave>
// Is this company still open for business?
//
// Deactivating a company wrote a flag that nothing read: new masters and new
// transactions carried on being created in it exactly as before, which made the
// button a label rather than a decision. Reported from production, and the same
// shape as three faults before it — a stored value with nothing acting on it.
//
// Kept out of `companies/service.ts` on purpose: this is called from the request
// pipeline for every write, and the service imports enough of the feature to make
// that a cycle.
import { eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { companies } from "@/core/db/schema.js";
import { logger } from "@/core/logger.js";
import { redis } from "@/core/redis.js";

const KEY = (companyId: string) => `company-status:${companyId}`;
/**
 * Short, because the window that matters is "somebody just deactivated this and is
 * watching to see it take effect". Half a minute of staleness after a status change
 * is invisible; a request to Postgres on every write is not.
 */
const TTL_SECONDS = 30;

/** Forget the cached status — called whenever the status is written. */
export async function forgetCompanyStatus(companyId: string): Promise<void> {
  try {
    await redis.del(KEY(companyId));
  } catch {
    // Best effort: the entry expires on its own within TTL_SECONDS.
  }
}

/**
 * True when the company may still be written to.
 *
 * Fails **open** — an unknown company, or a cache and database that cannot answer,
 * is not treated as deactivated. Refusing every write because a lookup failed would
 * turn a slow query into an outage, and the flag is an administrative choice rather
 * than a security boundary: access is decided by `hasCompanyAccess`, which has
 * already run by the time this is asked.
 */
export async function isCompanyActive(companyId: string): Promise<boolean> {
  try {
    const cached = await redis.get(KEY(companyId));
    if (cached !== null) return cached === "active";
  } catch {
    // Fall through to the database.
  }

  try {
    const [row] = await db
      .select({ status: companies.status })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    if (!row) return true;

    try {
      await redis.set(KEY(companyId), row.status, "EX", TTL_SECONDS);
    } catch {
      // Best effort.
    }
    return row.status !== "inactive";
  } catch (error) {
    logger.warn({ err: error, companyId }, "Could not read company status; allowing the write");
    return true;
  }
}
