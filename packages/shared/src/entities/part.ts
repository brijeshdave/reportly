// Author: Brijesh Dave <https://github.com/brijeshdave>
// Rotables: items with their own identity that cycle stock → installed →
// workshop → stock, gathering a service history and a cycle count on the way.
//
// The immediate use is printer cartridges — refilled and repaired, deployed to
// particular printers, consuming toner powder, drums and blades. But that is one
// instance of a standard maintenance shape, the same as UPS batteries, filter
// units and calibrated tools. So the vocabulary lives in DATA — service kinds,
// consumables, compatibility are all catalogues a company fills in — and the
// screens are labelled "Cartridges" because that is what this company calls them.
//
// Nothing here knows what toner is. That is the point: a column called
// `toner_grams` would have made a second module inevitable the day somebody
// tracked a battery.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";

/**
 * Where a part is in its cycle.
 *
 *   needs_service — on the shelf and NOT usable: newly collected, or just back
 *                   from a machine. Refill or repair it before it goes out
 *   ready         — serviced and deployable. The only state an install accepts
 *   installed     — doing a tour of duty on a device
 *   scrapped      — retired; the end state, and the only one it never leaves
 *
 * `needs_service` and `ready` were one state called "in stock", which was two
 * answers wearing one name: a cartridge just refilled and a cartridge sitting
 * empty looked identical, and both could be installed. Whether a part is usable
 * is the question this module exists to answer, so it is the status.
 */
export const PART_STATUSES = ["needs_service", "ready", "installed", "scrapped"] as const;
export type PartStatus = (typeof PART_STATUSES)[number];
export const partStatusSchema = z.enum(PART_STATUSES);

export const PART_STATUS_LABELS: Record<PartStatus, string> = {
  needs_service: "Needs service",
  ready: "Ready",
  installed: "Installed",
  scrapped: "Scrapped",
};

/** The states a part may be registered in. It is either usable or it is not. */
export const INITIAL_PART_STATUSES = ["needs_service", "ready"] as const;

/**
 * How a tour of duty ended.
 *
 * `faulty` is not a comment — it is what triggers the points reversal when the
 * part failed inside its window, so it has to be recorded at the moment of
 * return rather than inferred later from a note somebody typed.
 */
export const PLACEMENT_OUTCOMES = ["ok", "faulty"] as const;
export type PlacementOutcome = (typeof PLACEMENT_OUTCOMES)[number];
export const placementOutcomeSchema = z.enum(PLACEMENT_OUTCOMES);

/**
 * How a consumable is counted.
 *
 * Toner is weighed and a drum is counted, and "some toner" is not an answer a
 * technician can act on later. Deliberately short: this is a unit of measure, not
 * an inventory system — there are no balances anywhere in this module.
 */
export const CONSUMABLE_UNITS = ["ea", "g", "ml"] as const;
export type ConsumableUnit = (typeof CONSUMABLE_UNITS)[number];
export const consumableUnitSchema = z.enum(CONSUMABLE_UNITS);

export const CONSUMABLE_UNIT_LABELS: Record<ConsumableUnit, string> = {
  ea: "each",
  g: "grams",
  ml: "millilitres",
};

/* -------------------------------- catalogues ------------------------------- */

/**
 * What one kind of service is allowed to consume, and how much.
 *
 * A refill takes toner and nothing else; a repair takes drums and blades and
 * never toner. Offering the whole cupboard for both is how a record ends up
 * saying a refill fitted a drum.
 *
 * `min` of 1 makes the consumable required — a refill that used no toner did not
 * happen. `max` caps it, so a slipped decimal point is refused rather than
 * recorded. Null max means no ceiling.
 *
 * **`max` of 0 is allowed, and means "not this one".** It used to be `positive()`,
 * which refused zero — so a repair that fits no parts at all could not be described:
 * the form was rejected with nothing to say which field was wrong. An empty consumable
 * list cannot express it either, because empty means *unrestricted* rather than none.
 */
export const serviceKindConsumableSchema = z
  .object({
    consumableId: uuidSchema,
    minQuantity: z.number().min(0).max(1_000_000).default(0),
    maxQuantity: z.number().min(0).max(1_000_000).nullable().default(null),
  })
  .refine((value) => value.maxQuantity === null || value.maxQuantity >= value.minQuantity, {
    message: "The most cannot be less than the least",
    path: ["maxQuantity"],
  });
export type ServiceKindConsumable = z.infer<typeof serviceKindConsumableSchema>;

/**
 * What can be done to a part: Refill, Repair, and whatever else a company names.
 *
 * A catalogue rather than an enum because the whole module is meant to outlive
 * cartridges. `defaultPoints` is the fallback; a part model may pay differently
 * for the same kind (see the rate below), since refilling a big cartridge is not
 * the same job as refilling a small one.
 */
export const serviceKindSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    description: z.string().nullable(),
    defaultPoints: z.number().min(0).max(1000),
    status: z.enum(["active", "inactive"]),
    /** What it may consume, and how much. Empty means unrestricted. */
    consumables: z.array(serviceKindConsumableSchema),
  })
  .merge(timestampsSchema);
export type ServiceKind = z.infer<typeof serviceKindSchema>;

export const createServiceKindSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(500).optional(),
  defaultPoints: z.number().min(0).max(1000).default(0),
  /**
   * The consumables this kind may use. An empty list is "not restricted yet" —
   * every consumable is offered and none required — so adding this rule breaks
   * no kind that predates it. Once a kind lists any, those are the only ones it
   * can consume.
   */
  consumables: z.array(serviceKindConsumableSchema).max(50).optional(),
});
export type CreateServiceKind = z.infer<typeof createServiceKindSchema>;

/**
 * Something used up by a service: toner powder, an OPC drum, a wiper blade.
 *
 * A list of names and their unit, and nothing else. There is no stock level, no
 * reorder point and no price anywhere in this module — it records what a job
 * consumed, and must never look like it knows what is left in the cupboard.
 */
export const consumableSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    unit: consumableUnitSchema,
    status: z.enum(["active", "inactive"]),
  })
  .merge(timestampsSchema);
export type Consumable = z.infer<typeof consumableSchema>;

export const createConsumableSchema = z.object({
  name: nameSchema,
  unit: consumableUnitSchema.default("ea"),
});
export type CreateConsumable = z.infer<typeof createConsumableSchema>;

/**
 * A kind of part: "HP 12A Toner". The catalogue entry every individual unit
 * points at, carrying what it fits and how many cycles it is good for.
 */
export const partModelSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    description: z.string().nullable(),
    /**
     * How many services this model is rated for. Null means no limit, which is a
     * legitimate answer — plenty of rotables have no manufacturer figure.
     *
     * Passing it warns and never refuses: the number is the maker's opinion, and a
     * technician holding the part has better information. Blocking would only
     * teach people to re-register it under a new identifier.
     */
    cycleLimit: z.number().int().min(1).max(1000).nullable(),
    /**
     * What one charge of this model ought to produce — the maker's page yield.
     *
     * Null is a real answer, not a zero: plenty of parts have no published
     * figure, and a zero here would read as "produces nothing". Like the cycle
     * limit it is compared against and never enforced.
     */
    ratedPageYield: z.number().int().min(1).max(1_000_000).nullable(),
    status: z.enum(["active", "inactive"]),
    /** Device types this model fits. A deploy to anything else is refused. */
    compatibleDeviceTypeIds: z.array(uuidSchema),
  })
  .merge(timestampsSchema);
export type PartModel = z.infer<typeof partModelSchema>;

export const createPartModelSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(1000).optional(),
  cycleLimit: z.number().int().min(1).max(1000).nullable().optional(),
  ratedPageYield: z.number().int().min(1).max(1_000_000).nullable().optional(),
  compatibleDeviceTypeIds: z.array(uuidSchema).default([]),
});
export type CreatePartModel = z.infer<typeof createPartModelSchema>;

/** What one model pays for one kind of service, overriding the kind's default. */
export const serviceRateSchema = z.object({
  serviceKindId: uuidSchema,
  points: z.number().min(0).max(1000),
});
export type ServiceRate = z.infer<typeof serviceRateSchema>;

/* ---------------------------------- parts ---------------------------------- */

export const partSchema = z
  .object({
    id: uuidSchema,
    /** The label the team writes on the part. Unique within a company. */
    identifier: z.string().trim().min(1).max(64),
    partModelId: uuidSchema,
    partModelName: nameSchema,
    status: partStatusSchema,
    /** How many services it has had. What the cycle limit is compared against. */
    cycleCount: z.number().int().min(0),
    /** True once `cycleCount` has passed the model's limit. Advisory, never a block. */
    overCycleLimit: z.boolean(),
    /** Where it sits while in stock. Null once it is installed somewhere. */
    locationId: uuidSchema.nullable(),
    locationName: z.string().nullable(),
    /** The device it is on now, when it is installed. */
    deviceId: uuidSchema.nullable(),
    deviceName: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .merge(timestampsSchema);
export type Part = z.infer<typeof partSchema>;

export const createPartSchema = z.object({
  identifier: z.string().trim().min(1).max(64),
  partModelId: uuidSchema,
  /**
   * Whether it arrives usable. A new cartridge from the supplier is ready; one
   * collected from a printer for refilling is not, and defaulting to that is the
   * safe direction — a part wrongly marked ready gets installed empty.
   */
  status: z.enum(INITIAL_PART_STATUSES).default("needs_service"),
  locationId: uuidSchema.nullable().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreatePart = z.infer<typeof createPartSchema>;

export const updatePartSchema = createPartSchema
  .partial()
  .omit({ partModelId: true, status: true });
export type UpdatePart = z.infer<typeof updatePartSchema>;

/* ------------------------------- tours of duty ----------------------------- */

/**
 * One tour of duty, kept append-only.
 *
 * The part carries where it is *now* because every list needs that cheaply; this
 * is where it has *been*, which is the thing that answers "how long did the last
 * refill last" and "which printer keeps eating cartridges".
 */
export const placementSchema = z
  .object({
    id: uuidSchema,
    partId: uuidSchema,
    deviceId: uuidSchema,
    deviceName: z.string(),
    installedAt: z.string().datetime(),
    installedByName: z.string().nullable(),
    removedAt: z.string().datetime().nullable(),
    removedByName: z.string().nullable(),
    outcome: placementOutcomeSchema.nullable(),
    note: z.string().nullable(),
    /**
     * The host machine's own counter when the part went in and came out.
     *
     * Two readings rather than one "pages printed" box, because the person
     * booking a part in can read today's counter and cannot know what it said
     * when the part went in — weeks ago, quite possibly under somebody else.
     * Each person records what is in front of them and the subtraction is ours.
     */
    meterStart: z.number().int().min(0).nullable(),
    meterEnd: z.number().int().min(0).nullable(),
    /** Said directly, for a machine with no counter to read. */
    pagesPrinted: z.number().int().min(0).nullable(),
  })
  .merge(timestampsSchema);
export type Placement = z.infer<typeof placementSchema>;

export const deployPartSchema = z.object({
  deviceId: uuidSchema,
  note: z.string().trim().max(1000).optional(),
  meterStart: z.number().int().min(0).max(100_000_000).nullable().optional(),
});
export type DeployPart = z.infer<typeof deployPartSchema>;

export const returnPartSchema = z.object({
  outcome: placementOutcomeSchema,
  note: z.string().trim().max(1000).optional(),
  meterEnd: z.number().int().min(0).max(100_000_000).nullable().optional(),
  pagesPrinted: z.number().int().min(0).max(100_000_000).nullable().optional(),
});
export type ReturnPart = z.infer<typeof returnPartSchema>;

/* --------------------------------- yield ---------------------------------- */

/**
 * How many pages a tour of duty produced, and where the number came from.
 *
 * `from` is part of the answer rather than a detail: "we do not know" and "the
 * meter went backwards" want different words on screen, and a screen that
 * cannot tell them apart tells the reader to fix the wrong thing.
 */
export type PageCount =
  { pages: number; from: "meters" | "entered" } | { pages: null; from: "unknown" | "meter-reset" };

/**
 * The one place a page count is derived. Both the API and the screens call it,
 * for the same reason `rateFor` lives in one place: two implementations of the
 * same arithmetic drift, and the drift is invisible until somebody compares two
 * screens showing different numbers for one cartridge.
 *
 * Meters win when they are usable, since they are read off the machine rather
 * than remembered. A meter that went backwards is a reset or a replaced printer,
 * never negative pages — it falls back to a typed count if there is one, and
 * otherwise says so. Reporting a confident wrong number would be worse than
 * reporting none.
 */
export function pagesFor(tour: {
  meterStart: number | null;
  meterEnd: number | null;
  pagesPrinted: number | null;
}): PageCount {
  const { meterStart, meterEnd, pagesPrinted } = tour;
  const metered = meterStart !== null && meterEnd !== null;

  if (metered && meterEnd >= meterStart) return { pages: meterEnd - meterStart, from: "meters" };
  if (pagesPrinted !== null) return { pages: pagesPrinted, from: "entered" };
  return { pages: null, from: metered ? "meter-reset" : "unknown" };
}

/**
 * What fraction of the model's rated yield a tour actually gave, as a percentage.
 *
 * Null whenever either half is missing, which is the common case early on — a
 * company that has not entered a rated figure gets page counts and no
 * comparison, rather than a comparison against zero.
 */
export function yieldPercent(pages: number | null, ratedPageYield: number | null): number | null {
  if (pages === null || ratedPageYield === null || ratedPageYield <= 0) return null;
  return Math.round((pages / ratedPageYield) * 100);
}

/**
 * The mean pages across the tours that have a number, ignoring those that do not.
 *
 * Ignoring rather than counting them as zero: an unmeasured tour would otherwise
 * drag the average down and make a healthy part look like a failing one — the
 * same reason MTBF is null rather than zero when nothing has failed.
 */
export function meanPages(
  tours: { meterStart: number | null; meterEnd: number | null; pagesPrinted: number | null }[],
): number | null {
  const known = tours.map((tour) => pagesFor(tour).pages).filter((pages) => pages !== null);
  if (known.length === 0) return null;
  return Math.round(known.reduce((sum, pages) => sum + pages, 0) / known.length);
}

/**
 * The part, plus whether booking it in took points back.
 *
 * Said out loud rather than left for the technician to discover on somebody's
 * leaderboard next week: a reversal is a consequence of the button they just
 * pressed, and a system that removes points silently is one people stop trusting.
 */
export const returnedPartSchema = partSchema.extend({ pointsReversed: z.boolean() });
export type ReturnedPart = z.infer<typeof returnedPartSchema>;

/* ------------------------------ service events ----------------------------- */

export const serviceConsumptionSchema = z.object({
  consumableId: uuidSchema,
  consumableName: z.string(),
  unit: consumableUnitSchema,
  quantity: z.number().positive().max(1_000_000),
});
export type ServiceConsumption = z.infer<typeof serviceConsumptionSchema>;

export const serviceEventSchema = z
  .object({
    id: uuidSchema,
    partId: uuidSchema,
    serviceKindId: uuidSchema,
    serviceKindName: nameSchema,
    performedByName: z.string().nullable(),
    performedAt: z.string().datetime(),
    notes: z.string().nullable(),
    /** What it paid. Recorded here for display; the ledger remains the truth. */
    points: z.number(),
    /** Set once a failure in the window reversed it. */
    pointsReversedAt: z.string().datetime().nullable(),
    consumptions: z.array(serviceConsumptionSchema),
  })
  .merge(timestampsSchema);
export type ServiceEvent = z.infer<typeof serviceEventSchema>;

export const recordServiceSchema = z.object({
  serviceKindId: uuidSchema,
  /** Defaults to now. Given, because a refill is often booked after the fact. */
  performedAt: z.string().datetime().optional(),
  notes: z.string().trim().max(2000).optional(),
  consumptions: z
    .array(z.object({ consumableId: uuidSchema, quantity: z.number().positive().max(1_000_000) }))
    .max(50)
    .default([]),
});
export type RecordService = z.infer<typeof recordServiceSchema>;

/* -------------------------------- timeline --------------------------------- */

/**
 * One thing that happened to a part.
 *
 * The page used to show two lists side by side — what was done to it, and where
 * it had been — which is fine for reading and useless for analysing. "Was it
 * refilled before or after that printer chewed it?" is a question about ONE
 * sequence, and two lists make the reader interleave them by eye.
 *
 * `scrapped` is deliberately absent: nothing records WHEN a part was scrapped,
 * and dating it from `updatedAt` would be a guess presented as a fact. The status
 * says it plainly enough.
 */
export const PART_EVENT_KINDS = ["registered", "installed", "removed", "serviced"] as const;
export type PartEventKind = (typeof PART_EVENT_KINDS)[number];

export const PART_EVENT_LABELS: Record<PartEventKind, string> = {
  registered: "Registered",
  installed: "Installed",
  removed: "Taken out",
  serviced: "Serviced",
};

export const partEventSchema = z.object({
  /** Unique within the timeline; a placement contributes two events, so not its own id. */
  id: z.string(),
  at: z.string().datetime(),
  kind: z.enum(PART_EVENT_KINDS),
  actorName: z.string().nullable(),
  deviceName: z.string().nullable(),
  serviceKindName: z.string().nullable(),
  outcome: placementOutcomeSchema.nullable(),
  /** What the service paid, and whether a faulty return took it back. */
  points: z.number().nullable(),
  pointsReversedAt: z.string().datetime().nullable(),
  /** The raw readings, so the one `pagesFor` derives the count for every screen. */
  meterStart: z.number().int().nullable(),
  meterEnd: z.number().int().nullable(),
  pagesPrinted: z.number().int().nullable(),
  consumptions: z.array(serviceConsumptionSchema),
  note: z.string().nullable(),
});
export type PartEvent = z.infer<typeof partEventSchema>;
