// Author: Brijesh Dave <https://github.com/brijeshdave>
// The knobs that make the reports domain fit any organisation without touching
// code: severity levels, the status workflow, and the per-department categories a
// report is filed under.
//
// Severities and statuses are global — one organisation runs one severity ladder
// and one workflow. Categories are per-department, because "what kind of issue" is
// department-specific (a Maintenance category means nothing to Finance).
import { z } from "zod";

import {
  entityStatusSchema,
  nameSchema,
  timestampsSchema,
  uuidSchema,
  patchSchemaOf,
} from "@/entities/common.js";

/* ------------------------------- Severities -------------------------------- */

/**
 * A severity level — how serious an issue is, and nothing more.
 *
 * It used to carry a **weight** that multiplied a mark into points. Scoring is now
 * a fixed pot of at most ten points shared among whoever worked the entry, judged
 * by the author and again by their manager, and severity is not part of that
 * arithmetic. The weight was left behind as a field that was stored, shown and
 * editable while being read by nothing — the same shape as four separate bugs in
 * this codebase's history — so it is gone rather than quietly ignored.
 *
 * Severity still matters: it labels the entry, orders the ladder, and drives the
 * reliability figures and the reports that group by it.
 */
export const severitySchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    /** Where it sits in the ladder, low to high. */
    orderIndex: z.number().int(),
    /**
     * The most one entry at this severity may be worth, shared among everyone who
     * worked it.
     *
     * A ceiling, not a fixed award: two Major jobs are not equally hard, so the
     * severity says how much is available and judgement decides how much of it is
     * earned. Ten everywhere until somebody sets it, which is what every entry was
     * worth before this existed.
     */
    maxPoints: z.number().min(0).max(10),
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);

export type Severity = z.infer<typeof severitySchema>;

export const createSeveritySchema = z.object({
  name: nameSchema,
  orderIndex: z.number().int().default(0),
  // In half-point steps like every other number in the scoring model.
  maxPoints: z.number().min(0).max(10).multipleOf(0.5).default(10),
  status: entityStatusSchema.default("active"),
});
export type CreateSeverity = z.infer<typeof createSeveritySchema>;

export const updateSeveritySchema = patchSchemaOf(createSeveritySchema);
export type UpdateSeverity = z.infer<typeof updateSeveritySchema>;

/* -------------------------------- Statuses --------------------------------- */

/**
 * The three states any report status ultimately falls into, whatever an
 * organisation calls its steps. The engine reads the group; the name is the
 * organisation's to choose. "open" is still being worked; "resolved" is a good
 * ending; "rejected" is a not-a-real-issue ending.
 */
export const STATUS_GROUPS = ["open", "resolved", "rejected"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];
export const statusGroupSchema = z.enum(STATUS_GROUPS);

export const journalStatusSchema = z
  .object({
    id: uuidSchema,
    name: nameSchema,
    group: statusGroupSchema,
    /** A terminal status ends the workflow — nothing follows it. */
    isTerminal: z.boolean(),
    orderIndex: z.number().int(),
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);

export type JournalStatus = z.infer<typeof journalStatusSchema>;

export const createReportStatusSchema = z.object({
  name: nameSchema,
  group: statusGroupSchema.default("open"),
  isTerminal: z.boolean().default(false),
  orderIndex: z.number().int().default(0),
  status: entityStatusSchema.default("active"),
});
export type CreateReportStatus = z.infer<typeof createReportStatusSchema>;

export const updateReportStatusSchema = patchSchemaOf(createReportStatusSchema);
export type UpdateReportStatus = z.infer<typeof updateReportStatusSchema>;

/* ------------------------------- Categories -------------------------------- */

/**
 * A report category, owned by a department. Names are unique within a department,
 * not across the company: two departments may each have a "Safety" category and
 * mean different things by it.
 */
export const categorySchema = z
  .object({
    id: uuidSchema,
    departmentId: uuidSchema,
    name: nameSchema,
    description: z.string().nullable(),
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);

export type Category = z.infer<typeof categorySchema>;

/** A category as listed, with its department resolved for display. */
export const categoryRowSchema = categorySchema.extend({
  departmentName: nameSchema,
});
export type CategoryRow = z.infer<typeof categoryRowSchema>;

/** A description is free text explaining when to pick this one — the thing that
 *  stops two similar categories being used interchangeably. */
const descriptionSchema = z.string().trim().max(500);

export const createCategorySchema = z.object({
  departmentId: uuidSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  status: entityStatusSchema.default("active"),
});
export type CreateCategory = z.infer<typeof createCategorySchema>;

// departmentId is fixed after creation — moving a category between departments
// would silently re-file every report under it.
export const updateCategorySchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  status: entityStatusSchema.optional(),
});
export type UpdateCategory = z.infer<typeof updateCategorySchema>;

/* ------------------------------- Device types ------------------------------ */

/**
 * What kind of thing a device is. Per department, exactly like categories — and
 * for the same reason: the vocabulary belongs to the people using it, and two
 * departments may each keep a "Pump" meaning their own.
 */
export const deviceTypeSchema = z
  .object({
    id: uuidSchema,
    departmentId: uuidSchema,
    name: nameSchema,
    description: z.string().nullable(),
    /**
     * Whether an outage on a device of this type stops production.
     *
     * Off by default, because most devices are desks and laptops and switches:
     * a PC being dead is a job to do, not an outage to measure. Switch it on for
     * the ones that genuinely halt something — a label printer on the line, say.
     */
    tracksDowntime: z.boolean(),
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);
export type DeviceType = z.infer<typeof deviceTypeSchema>;

export const deviceTypeRowSchema = deviceTypeSchema.extend({ departmentName: nameSchema });
export type DeviceTypeRow = z.infer<typeof deviceTypeRowSchema>;

export const createDeviceTypeSchema = z.object({
  departmentId: uuidSchema,
  name: nameSchema,
  tracksDowntime: z.boolean().default(false),
  description: descriptionSchema.optional(),
  status: entityStatusSchema.default("active"),
});
export type CreateDeviceType = z.infer<typeof createDeviceTypeSchema>;

// departmentId is fixed after creation, like a category's: moving a type between
// departments would silently re-label every device holding it.
export const updateDeviceTypeSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  tracksDowntime: z.boolean().optional(),
  status: entityStatusSchema.optional(),
});
export type UpdateDeviceType = z.infer<typeof updateDeviceTypeSchema>;

/* ---------------------------------- Tags ----------------------------------- */

/**
 * A free label for finding work later, department-scoped and multi-select.
 *
 * The rule that keeps this apart from a category, and it belongs in the docs as
 * much as here: **the category is what kind of problem it is — exactly one, and
 * what the recurring-issue analytics groups by. Tags are everything else you might
 * want to search by, as many as apply.**
 */
/**
 * The palette a new tag is coloured from. Twenty hues, evenly spaced around the
 * wheel at a mid lightness, so that:
 *   - adjacent tags in a list are tellable apart at a glance,
 *   - every one carries readable text in both light and dark themes without the
 *     UI having to compute a contrasting foreground per tag.
 *
 * Shared rather than defined in the web app, because the API picks the colour when
 * a tag is created and the browser renders it — two consumers, so it is a
 * cross-tier fact and lives here by the same rule as PAGE_SIZE_OPTIONS.
 */
export const TAG_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#ec4899", // pink
  "#f43f5e", // rose
  "#78716c", // stone
  "#64748b", // slate
  "#0f766e", // deep teal
] as const;

/** `#rrggbb`, lowercase or upper. Anything else is refused rather than coerced —
 *  a colour the browser cannot parse renders as an invisible chip. */
export const tagColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #3b82f6");

export const tagSchema = z
  .object({
    id: uuidSchema,
    departmentId: uuidSchema,
    name: nameSchema,
    description: z.string().nullable(),
    /** Always set: the server picks one from TAG_COLORS when the caller does not,
     *  so a tag is never rendered colourless. */
    color: z.string(),
    status: entityStatusSchema,
  })
  .merge(timestampsSchema);
export type Tag = z.infer<typeof tagSchema>;

export const tagRowSchema = tagSchema.extend({ departmentName: nameSchema });
export type TagRow = z.infer<typeof tagRowSchema>;

export const createTagSchema = z.object({
  departmentId: uuidSchema,
  name: nameSchema,
  description: descriptionSchema.optional(),
  /** Omit to have one picked from the palette; send any hex for a custom colour. */
  color: tagColorSchema.optional(),
  status: entityStatusSchema.default("active"),
});
export type CreateTag = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: nameSchema.optional(),
  description: descriptionSchema.nullable().optional(),
  color: tagColorSchema.optional(),
  status: entityStatusSchema.optional(),
});
export type UpdateTag = z.infer<typeof updateTagSchema>;

/** What a tag is attached to. Mirrors the attachments owner shape. */
export const TAGGABLE_TYPES = ["report", "task"] as const;
export type TaggableType = (typeof TAGGABLE_TYPES)[number];
export const taggableTypeSchema = z.enum(TAGGABLE_TYPES);
