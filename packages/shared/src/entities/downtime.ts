// Author: Brijesh Dave <https://github.com/brijeshdave>
// Downtime — how long a *thing* was out of service. This is not the report's work
// time (how long the *person* spent); the two are different clocks and are kept
// apart on purpose. A downtime entry is raised from a report against one of the
// things that report is about, and stays **open** (no end time) until someone
// closes it, so a running outage shows in a pending queue and the per-thing total
// keeps climbing until it is resolved.
import { z } from "zod";

import { timestampsSchema, uuidSchema } from "@/entities/common.js";

/** Only physical things go down — not a user or a whole department. */
export const DOWNTIME_TARGET_KINDS = ["asset", "device"] as const;
export type DowntimeTargetKind = (typeof DOWNTIME_TARGET_KINDS)[number];
export const downtimeTargetKindSchema = z.enum(DOWNTIME_TARGET_KINDS);

const reasonSchema = z.string().trim().max(2000);

export const downtimeEntrySchema = z
  .object({
    id: uuidSchema,
    companyId: uuidSchema,
    reportId: uuidSchema,
    targetKind: downtimeTargetKindSchema,
    targetId: z.string(),
    targetLabel: z.string(),
    reason: z.string().nullable(),
    startedAt: z.string().datetime(),
    /** null = still down (an open entry). */
    endedAt: z.string().datetime().nullable(),
    /** endedAt − startedAt, in minutes; null while open. */
    durationMinutes: z.number().nullable(),
    createdBy: z.string(),
    createdByName: z.string(),
  })
  .merge(timestampsSchema);
export type DowntimeEntry = z.infer<typeof downtimeEntrySchema>;

export const createDowntimeSchema = z
  .object({
    reportId: uuidSchema,
    targetKind: downtimeTargetKindSchema,
    targetId: z.string().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    reason: reasonSchema.optional(),
  })
  .refine((v) => !v.endedAt || v.endedAt >= v.startedAt, {
    message: "Downtime cannot end before it started",
    path: ["endedAt"],
  });
export type CreateDowntime = z.infer<typeof createDowntimeSchema>;

// Edit-to-close: fill in the end time on an open entry, correct the start, or amend
// the reason. Everything optional; the server re-checks start ≤ end after applying.
export const updateDowntimeSchema = z.object({
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  reason: reasonSchema.nullable().optional(),
});
export type UpdateDowntime = z.infer<typeof updateDowntimeSchema>;

/** A per-thing roll-up: total minutes down and how many outages are still open. */
export const downtimeTotalSchema = z.object({
  targetKind: downtimeTargetKindSchema,
  targetId: z.string(),
  targetLabel: z.string(),
  totalMinutes: z.number(),
  openCount: z.number().int(),
  entryCount: z.number().int(),
});
export type DowntimeTotal = z.infer<typeof downtimeTotalSchema>;
