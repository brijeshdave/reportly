// Author: Brijesh Dave <https://github.com/brijeshdave>
// The printer's counter: what it last said, and recording what it says now.
//
// Kept apart from `parts-repo` because the counter is the *device's* fact. A
// cartridge has no count of its own — it moves between machines — so a tour's
// pages are the difference between two readings of one printer, and the printer's
// own output is the series. Both are read from here.
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { deviceMeterReadings, users } from "@/core/db/schema.js";

export type MeterSource = "install" | "removal" | "manual" | "reset";

export interface MeterReading {
  id: string;
  deviceId: string;
  pages: number;
  readAt: Date;
  source: MeterSource;
  placementId: string | null;
  note: string | null;
  readBy: string | null;
  /** Joined, because a history nobody is named in is hard to follow up. */
  readByName: string | null;
}

export interface NewReading {
  companyId: string;
  deviceId: string;
  pages: number;
  readAt?: Date;
  source: MeterSource;
  placementId?: string | null;
  note?: string | null;
  readBy?: string | null;
}

/**
 * The most recent reading for a printer, or null if it has never been read.
 *
 * "Most recent" is by `readAt` and then by insertion, not by the highest number:
 * a counter that has been reset legitimately reads lower than it did yesterday,
 * and taking the maximum would hide that forever.
 */
export async function lastReading(
  deviceId: string,
  companyId: string,
): Promise<MeterReading | null> {
  const [row] = await selectReadings()
    .where(
      and(eq(deviceMeterReadings.deviceId, deviceId), eq(deviceMeterReadings.companyId, companyId)),
    )
    .orderBy(desc(deviceMeterReadings.readAt), desc(deviceMeterReadings.createdAt))
    .limit(1);
  return row ? toReading(row) : null;
}

/** Every reading for a printer, oldest first — the series a report is built on. */
export async function readingsFor(
  deviceId: string,
  companyId: string,
  from?: Date,
  to?: Date,
): Promise<MeterReading[]> {
  const rows = await selectReadings()
    .where(
      and(
        eq(deviceMeterReadings.deviceId, deviceId),
        eq(deviceMeterReadings.companyId, companyId),
        from ? gte(deviceMeterReadings.readAt, from) : undefined,
        to ? lte(deviceMeterReadings.readAt, to) : undefined,
      ),
    )
    .orderBy(asc(deviceMeterReadings.readAt), asc(deviceMeterReadings.createdAt));
  return rows.map(toReading);
}

export async function recordReading(input: NewReading): Promise<string> {
  const [row] = await db
    .insert(deviceMeterReadings)
    .values({
      companyId: input.companyId,
      deviceId: input.deviceId,
      pages: input.pages,
      ...(input.readAt ? { readAt: input.readAt } : {}),
      source: input.source,
      placementId: input.placementId ?? null,
      note: input.note ?? null,
      readBy: input.readBy ?? null,
    })
    .returning({ id: deviceMeterReadings.id });
  return row!.id;
}

/** The columns every read of this table wants, with the reader's name joined. */
function selectReadings() {
  return db
    .select({
      id: deviceMeterReadings.id,
      deviceId: deviceMeterReadings.deviceId,
      pages: deviceMeterReadings.pages,
      readAt: deviceMeterReadings.readAt,
      source: deviceMeterReadings.source,
      placementId: deviceMeterReadings.placementId,
      note: deviceMeterReadings.note,
      readBy: deviceMeterReadings.readBy,
      readByName: users.name,
    })
    .from(deviceMeterReadings)
    .leftJoin(users, eq(users.id, deviceMeterReadings.readBy));
}

function toReading(row: {
  id: string;
  deviceId: string;
  pages: number;
  readAt: Date;
  source: string;
  placementId: string | null;
  note: string | null;
  readBy: string | null;
  readByName: string | null;
}): MeterReading {
  return { ...row, source: row.source as MeterSource };
}

/**
 * Move the reading a tour recorded, so the printer's series says what the tour
 * says.
 *
 * Without this a correction would fix the tour and leave the series behind it
 * untouched, and the two page-count reports — one built on tours, one on the
 * series — would start disagreeing. They are meant to agree by construction.
 *
 * `null` deletes the reading rather than storing a nought: a reading nobody can
 * recall is no reading, and a zero would be read as a counter that said zero.
 */
export async function correctReadingFor(
  placementId: string,
  source: "install" | "removal",
  pages: number | null,
): Promise<void> {
  const where = and(
    eq(deviceMeterReadings.placementId, placementId),
    eq(deviceMeterReadings.source, source),
  );
  if (pages === null) {
    await db.delete(deviceMeterReadings).where(where);
    return;
  }
  await db.update(deviceMeterReadings).set({ pages, updatedAt: new Date() }).where(where);
}
