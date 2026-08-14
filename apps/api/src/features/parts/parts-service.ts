// Author: Brijesh Dave <https://github.com/brijeshdave>
// The lifecycle: register a part, put it on a printer, take it off again.
//
//   ready ──deploy──▶ installed ──return──▶ needs_service ──service/restock──▶ ready
//     │                                            │
//     └──────────────── scrap ─────────────────────┴──▶ scrapped
//
// Every transition is guarded here rather than trusted to the screen. A part on
// two printers at once, or installed straight out of the workshop without being
// serviced, are states nothing downstream could make sense of — the placement
// history would stop being a history.
import {
  ERROR_CODES,
  toPaginatedResult,
  type CreatePart,
  type DeployPart,
  type Part,
  type PaginatedResult,
  type PartEvent,
  type PartStatus,
  type Placement,
  type ResolvedListQuery,
  type PlacementOutcome,
  type ReturnPart,
  type UpdatePart,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { serviceHistory } from "@/features/parts/service-service.js";
import { compatibilityFor } from "@/features/parts/catalogue-repo.js";
import * as repo from "@/features/parts/parts-repo.js";
import { reverseIfFailedInWindow } from "@/features/parts/service-service.js";

const iso = (d: Date) => d.toISOString();

function toPart(row: repo.PartRow, device: repo.PlacementRow | null): Part {
  return {
    id: row.id,
    identifier: row.identifier,
    partModelId: row.partModelId,
    partModelName: row.partModelName,
    status: row.status as PartStatus,
    cycleCount: row.cycleCount,
    // Advisory only. The maker's figure is an opinion and the technician holding
    // the part has better information, so this flags and never blocks.
    overCycleLimit: row.cycleLimit !== null && row.cycleCount >= row.cycleLimit,
    locationId: row.locationId,
    locationName: row.locationName,
    deviceId: device?.deviceId ?? null,
    deviceName: device?.deviceName ?? null,
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toPlacement(row: repo.PlacementRow): Placement {
  return {
    id: row.id,
    partId: row.partId,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    installedAt: iso(row.installedAt),
    installedByName: row.installedByName,
    removedAt: row.removedAt ? iso(row.removedAt) : null,
    removedByName: row.removedByName,
    outcome: (row.outcome as PlacementOutcome | null) ?? null,
    note: row.note,
    meterStart: row.meterStart,
    meterEnd: row.meterEnd,
    pagesPrinted: row.pagesPrinted,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function requirePart(id: string, companyId: string): Promise<repo.PartRow> {
  const row = await repo.getPart(id, companyId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Part not found");
  return row;
}

/** A part with where it is now — the open placement, when it is installed. */
async function withDevice(row: repo.PartRow, companyId: string): Promise<Part> {
  const open = row.status === "installed" ? await repo.openPlacement(row.id, companyId) : null;
  return toPart(row, open);
}

export async function listParts(
  companyId: string,
  query: ResolvedListQuery,
): Promise<PaginatedResult<Part>> {
  const { rows, total } = await repo.listParts(companyId, query);
  const withDevices = await Promise.all(rows.map((row) => withDevice(row, companyId)));
  return toPaginatedResult(withDevices, total, query);
}

export async function getPart(id: string, companyId: string): Promise<Part> {
  return withDevice(await requirePart(id, companyId), companyId);
}

export async function createPart(companyId: string, input: CreatePart): Promise<Part> {
  const id = await repo.insertPart(companyId, {
    identifier: input.identifier,
    partModelId: input.partModelId,
    // A new cartridge from the supplier is usable; one collected for refilling is
    // not, and the caller is the only one who knows which.
    status: input.status,
    locationId: input.locationId ?? null,
    notes: input.notes ?? null,
  });
  return getPart(id, companyId);
}

export async function updatePart(id: string, companyId: string, input: UpdatePart): Promise<Part> {
  const row = await requirePart(id, companyId);
  if (row.status === "scrapped") {
    throw new AppError(409, ERROR_CODES.CONFLICT, "This part is scrapped and cannot be edited");
  }
  await repo.updatePart(id, companyId, {
    ...(input.identifier !== undefined ? { identifier: input.identifier } : {}),
    ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
    // Where it is stored only means anything while it is on a shelf. Setting it
    // on an installed part would put a second, contradictory answer next to the
    // placement that already says where it is.
    ...(input.locationId !== undefined && row.status !== "installed"
      ? { locationId: input.locationId ?? null }
      : {}),
  });
  return getPart(id, companyId);
}

/* -------------------------------- lifecycle -------------------------------- */

/**
 * Put a part on a printer.
 *
 * Only a **ready** part: one that needs service is empty or faulty, and putting
 * it in a machine is the mistake this state exists to prevent. That distinction
 * used to be invisible — "in stock" covered both, and both installed happily.
 */
export async function deployPart(
  id: string,
  companyId: string,
  userId: string,
  input: DeployPart,
): Promise<Part> {
  const part = await requirePart(id, companyId);
  if (part.status !== "ready") {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      part.status === "installed"
        ? "That part is already installed somewhere. Book it back in first."
        : part.status === "needs_service"
          ? "That part needs a refill or a repair before it can go out."
          : "A scrapped part cannot be installed.",
    );
  }

  const device = await repo.deviceTypeOf(input.deviceId, companyId);
  if (!device) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Device not found");

  const fits = await compatibilityFor(part.partModelId);
  if (!device.typeId || !fits.includes(device.typeId)) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `${part.partModelName} does not fit ${device.name}.`,
      { partModelId: part.partModelId, deviceId: device.id },
    );
  }

  await repo.insertPlacement(companyId, {
    partId: id,
    deviceId: input.deviceId,
    installedBy: userId,
    note: input.note ?? null,
    // The counter as it reads now. Half of a page count: on its own it says
    // nothing, and it is recorded here because this is the only moment anybody
    // is standing in front of the machine with the part in their hand.
    meterStart: input.meterStart ?? null,
  });
  // The placement now says where it is, so the stock location is cleared rather
  // than left behind to contradict it.
  await repo.updatePart(id, companyId, { status: "installed", locationId: null });
  return getPart(id, companyId);
}

/**
 * Take it off again.
 *
 * `outcome` is the caller's decision, not an inference: `faulty` is what will
 * reverse the points for the service that preceded it, and that has to be
 * somebody saying so rather than something read out of a note.
 *
 * Returns the part, and separately what the return did to the points — the
 * caller needs that to say so and to notify, and the part itself cannot carry it.
 */
export async function returnPart(
  id: string,
  companyId: string,
  userId: string,
  input: ReturnPart,
): Promise<{ part: Part; reversal: { reversed: boolean; serviceEventId?: string } }> {
  const part = await requirePart(id, companyId);
  if (part.status !== "installed") {
    throw new AppError(409, ERROR_CODES.CONFLICT, "That part is not installed anywhere");
  }

  const open = await repo.openPlacement(id, companyId);
  if (!open) {
    // The status says installed and no open tour exists. Refusing beats inventing
    // a placement to close, which would put a fiction in the history.
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This part has no open placement to close. Its record needs correcting.",
    );
  }

  await repo.closePlacement(open.id, companyId, {
    removedBy: userId,
    outcome: input.outcome,
    note: input.note ?? null,
    ...(input.meterEnd !== undefined ? { meterEnd: input.meterEnd } : {}),
    ...(input.pagesPrinted !== undefined ? { pagesPrinted: input.pagesPrinted } : {}),
  });
  // Whatever the outcome, it came out of a machine: it is empty or it is faulty,
  // and either way it does not go straight back. `restockPart` is the way round
  // that for one which genuinely needs nothing.
  await repo.updatePart(id, companyId, { status: "needs_service" });

  // The points consequence, after the return has landed. Deliberately in this
  // order and deliberately unable to throw: a technician booking a faulty part
  // back in must succeed whatever the ledger decides, or the register starts
  // disagreeing with the shelf over an accounting detail.
  const reversal = await reverseIfFailedInWindow(
    { id, identifier: part.identifier },
    companyId,
    userId,
    { installedAt: open.installedAt, removedAt: new Date(), outcome: input.outcome },
  );

  return { part: await getPart(id, companyId), reversal };
}

/**
 * Back on the shelf without a service.
 *
 * A part that came off working — a printer retired, a wrong fit spotted early —
 * has nothing to refill. Forcing a fake service event to move it would put points
 * in the ledger for work nobody did.
 */
export async function restockPart(
  id: string,
  companyId: string,
  locationId?: string | null,
): Promise<Part> {
  const part = await requirePart(id, companyId);
  if (part.status !== "needs_service") {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      part.status === "ready"
        ? "That part is already ready to go out."
        : "Only a part awaiting service can be marked ready without one.",
    );
  }
  await repo.updatePart(id, companyId, {
    status: "ready",
    ...(locationId !== undefined ? { locationId: locationId ?? null } : {}),
  });
  return getPart(id, companyId);
}

/**
 * Retire it for good.
 *
 * Never from `installed`: a part inside a machine is still inside it, and marking
 * it scrapped would leave an open placement pointing at a device that thinks it
 * has a working part. Book it back in first.
 */
export async function scrapPart(id: string, companyId: string): Promise<Part> {
  const part = await requirePart(id, companyId);
  if (part.status === "installed") {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "Book the part back in before scrapping it — it is still in a machine.",
    );
  }
  if (part.status === "scrapped") return getPart(id, companyId);

  await repo.updatePart(id, companyId, { status: "scrapped", locationId: null });
  return getPart(id, companyId);
}

/**
 * The machines this part could go into.
 *
 * Compatibility is the model's, so this is the same question `deployPart` asks
 * when it refuses — asked before the choice rather than after it.
 */
export async function fittingDevices(
  id: string,
  companyId: string,
): Promise<{ id: string; name: string; typeName: string | null }[]> {
  const part = await requirePart(id, companyId);
  return repo.devicesFittingModel(part.partModelId, companyId);
}

/**
 * Everything that has happened to this part, newest first.
 *
 * Merged from the two histories rather than stored as a third: a placement and a
 * service event are the facts, and a timeline is a way of reading them. Keeping a
 * separate event log would be a second copy to drift.
 *
 * A placement yields two events — it went in, and later it came out — because
 * those happened weeks apart and reading them as one row is what made the
 * separate lists hard to follow.
 */
export async function partTimeline(id: string, companyId: string): Promise<PartEvent[]> {
  const part = await requirePart(id, companyId);
  const [tours, services] = await Promise.all([
    repo.placementsFor(id, companyId),
    serviceHistory(id, companyId),
  ]);

  const events: PartEvent[] = [
    {
      id: `registered:${part.id}`,
      at: iso(part.createdAt),
      kind: "registered",
      // Nothing records who registered a part; inventing an actor from the audit
      // trail would be a different fact wearing this one's name.
      actorName: null,
      deviceName: null,
      serviceKindName: null,
      outcome: null,
      points: null,
      pointsReversedAt: null,
      meterStart: null,
      meterEnd: null,
      pagesPrinted: null,
      consumptions: [],
      note: null,
    },
  ];

  for (const tour of tours) {
    events.push({
      id: `installed:${tour.id}`,
      at: iso(tour.installedAt),
      kind: "installed",
      actorName: tour.installedByName,
      deviceName: tour.deviceName,
      serviceKindName: null,
      outcome: null,
      points: null,
      pointsReversedAt: null,
      meterStart: tour.meterStart,
      meterEnd: null,
      pagesPrinted: null,
      consumptions: [],
      note: tour.note,
    });
    if (!tour.removedAt) continue;
    events.push({
      id: `removed:${tour.id}`,
      at: iso(tour.removedAt),
      kind: "removed",
      actorName: tour.removedByName,
      deviceName: tour.deviceName,
      serviceKindName: null,
      outcome: (tour.outcome as PlacementOutcome | null) ?? null,
      points: null,
      pointsReversedAt: null,
      // Both readings travel with the removal, so the client derives the pages
      // with the same function the API would.
      meterStart: tour.meterStart,
      meterEnd: tour.meterEnd,
      pagesPrinted: tour.pagesPrinted,
      consumptions: [],
      note: tour.note,
    });
  }

  for (const event of services) {
    events.push({
      id: `serviced:${event.id}`,
      at: event.performedAt,
      kind: "serviced",
      actorName: event.performedByName,
      deviceName: null,
      serviceKindName: event.serviceKindName,
      outcome: null,
      points: event.points,
      pointsReversedAt: event.pointsReversedAt,
      meterStart: null,
      meterEnd: null,
      pagesPrinted: null,
      consumptions: event.consumptions,
      note: event.notes,
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

/** Where this part has been. The history the current status cannot tell you. */
export async function partHistory(id: string, companyId: string): Promise<Placement[]> {
  await requirePart(id, companyId);
  return (await repo.placementsFor(id, companyId)).map(toPlacement);
}
