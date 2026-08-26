// Author: Brijesh Dave <https://github.com/brijeshdave>
// The two walks of the reporting line the reports domain needs, alongside the
// downward `downlineOf` the departments feature already has:
//
//   - ancestorsOf(user): everyone ABOVE them, with depth (1 = direct manager).
//     This is the appraisal chain — who may score a report, and whose marks are
//     hidden from whom.
//   - downlineUserIds(user): the flat set of everyone BELOW them, for scoping which
//     reports a manager may see.
//
// Both follow the same `reports_to_id` edges as the downline, and stop on a cycle
// the same way, so the picture the org chart draws and the access these grant can
// never disagree.
import { sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";

export interface Ancestor {
  userId: string;
  /** How far above — 1 is the person's direct manager. */
  depth: number;
}

/**
 * Everyone above `userId` in the reporting line, nearest first. A user may report
 * to different managers in different departments; each distinct ancestor is
 * returned once, at their shallowest depth (the closest way up to them).
 */
/**
 * Who will score this person's work — their reporting manager, by name.
 *
 * Null when nobody is set, and that is worth showing rather than hiding: an entry
 * with no reviewer is not "fine", it is work that will sit unscored until somebody
 * fixes the reporting line. The same fact `awaitingReviewFor` resolves for the
 * review list, made available to anything that wants to say who is waited on.
 *
 * `LIMIT 1` because somebody may sit in several departments and so have several
 * managers; the review is one person's to give, and this is the one the queue
 * uses.
 */
export async function reviewerFor(userId: string): Promise<{ id: string; name: string } | null> {
  const result = await db.execute<{ id: string; name: string }>(sql`
    SELECT u.id, u.name
    FROM department_users du
    JOIN users u ON u.id = du.reports_to_id
    WHERE du.user_id = ${userId} AND du.reports_to_id IS NOT NULL
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export async function ancestorsOf(userId: string): Promise<Ancestor[]> {
  const result = await db.execute<{ user_id: string; depth: number }>(sql`
    WITH RECURSIVE chain AS (
      SELECT du.reports_to_id AS user_id, 1 AS depth
      FROM department_users du
      WHERE du.user_id = ${userId} AND du.reports_to_id IS NOT NULL

      UNION ALL

      SELECT du.reports_to_id, c.depth + 1
      FROM department_users du
      JOIN chain c ON du.user_id = c.user_id
      WHERE du.reports_to_id IS NOT NULL
    ) CYCLE user_id SET is_cycle USING path
    SELECT user_id, MIN(depth) AS depth
    FROM chain
    WHERE NOT is_cycle
    GROUP BY user_id
    ORDER BY MIN(depth)
  `);

  return result.rows.map((row) => ({ userId: row.user_id, depth: Number(row.depth) }));
}

/** The flat set of everyone below `userId`, for scoping report visibility. */
/**
 * Everyone below `userId`, no deeper than `maxDepth`.
 *
 * Depth 1 is the people who report to them directly. The unbounded walk already
 * existed for visibility ("everything I may see"); this is the same walk stopped
 * early, because "my team" usually means the people I actually manage and not the
 * whole nested organisation four levels down.
 */
export async function downlineUserIdsToDepth(
  userId: string,
  maxDepth: number,
): Promise<Set<string>> {
  if (maxDepth <= 0) return new Set();
  if (!Number.isFinite(maxDepth)) return downlineUserIds(userId);

  const result = await db.execute<{ user_id: string }>(sql`
    WITH RECURSIVE downline AS (
      SELECT du.user_id, 1 AS depth
      FROM department_users du
      WHERE du.reports_to_id = ${userId}

      UNION ALL

      SELECT du.user_id, d.depth + 1
      FROM department_users du
      JOIN downline d ON du.reports_to_id = d.user_id
      WHERE d.depth < ${maxDepth}
    ) CYCLE user_id SET is_cycle USING path
    SELECT DISTINCT user_id FROM downline WHERE NOT is_cycle
  `);

  return new Set(result.rows.map((row) => row.user_id));
}

export async function downlineUserIds(userId: string): Promise<Set<string>> {
  const result = await db.execute<{ user_id: string }>(sql`
    WITH RECURSIVE downline AS (
      SELECT du.user_id
      FROM department_users du
      WHERE du.reports_to_id = ${userId}

      UNION ALL

      SELECT du.user_id
      FROM department_users du
      JOIN downline d ON du.reports_to_id = d.user_id
    ) CYCLE user_id SET is_cycle USING path
    SELECT DISTINCT user_id FROM downline WHERE NOT is_cycle
  `);

  return new Set(result.rows.map((row) => row.user_id));
}
