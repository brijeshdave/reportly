// Author: Brijesh Dave <https://github.com/brijeshdave>
// Data access for the self-serve points views. One query reads the source-aware points
// ledger over a window for a set of beneficiaries, joined to the person, the department,
// and whichever source (journal entry or routine) earned each award. The service shapes
// it into the ledger rows and the per-person summary.
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import {
  departments,
  journalEntries,
  pointAwards,
  parts,
  routines,
  serviceEvents,
  serviceKinds,
  users,
} from "@/core/db/schema.js";

export interface PointsLedgerRaw {
  id: string;
  earnedOn: string;
  source: string;
  kind: string;
  points: number;
  userId: string;
  userName: string;
  departmentName: string | null;
  journalTitle: string | null;
  routineTitle: string | null;
  partIdentifier: string | null;
  serviceKindName: string | null;
  /** Set on the compensating row a faulty return writes, so it can say so. */
  reversesAwardId: string | null;
}

/**
 * Every award earned in [from, to) for the visible beneficiaries, newest first. A null
 * `visibleUserIds` means the whole company (an analytics viewer); an empty list means no
 * one visible, so nothing.
 */
export async function pointsLedger(
  companyId: string,
  from: Date,
  to: Date,
  visibleUserIds: string[] | null,
): Promise<PointsLedgerRaw[]> {
  if (visibleUserIds && visibleUserIds.length === 0) return [];
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  return (
    db
      .select({
        id: pointAwards.id,
        earnedOn: pointAwards.earnedOn,
        source: pointAwards.source,
        kind: pointAwards.kind,
        points: pointAwards.points,
        userId: pointAwards.beneficiaryUserId,
        userName: users.name,
        departmentName: departments.name,
        journalTitle: journalEntries.title,
        routineTitle: routines.title,
        partIdentifier: parts.identifier,
        serviceKindName: serviceKinds.name,
        reversesAwardId: pointAwards.reversesAwardId,
      })
      .from(pointAwards)
      .innerJoin(users, eq(users.id, pointAwards.beneficiaryUserId))
      .leftJoin(departments, eq(departments.id, pointAwards.departmentId))
      .leftJoin(journalEntries, eq(journalEntries.id, pointAwards.reportId))
      .leftJoin(routines, eq(routines.id, pointAwards.routineId))
      // Two hops for one label, but the alternative is a denormalised "detail"
      // column on the ledger that would go stale the moment a part is relabelled.
      .leftJoin(serviceEvents, eq(serviceEvents.id, pointAwards.serviceEventId))
      .leftJoin(parts, eq(parts.id, serviceEvents.partId))
      .leftJoin(serviceKinds, eq(serviceKinds.id, serviceEvents.serviceKindId))
      .where(
        and(
          eq(pointAwards.companyId, companyId),
          gte(pointAwards.earnedOn, fromDate),
          lt(pointAwards.earnedOn, toDate),
          visibleUserIds ? inArray(pointAwards.beneficiaryUserId, visibleUserIds) : undefined,
        ),
      )
      .orderBy(desc(pointAwards.earnedOn))
  );
}
