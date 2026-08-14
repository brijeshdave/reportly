// Author: Brijesh Dave <https://github.com/brijeshdave>
// One line of the application log, as stored in the log database and served to
// the log viewer. Shared so the API response and the viewer cannot disagree.
import { z } from "zod";

import { logLevelSchema } from "@/settings/registry.js";

export const logEntrySchema = z.object({
  id: z.guid(),
  ts: z.string().datetime(),
  level: z.string(),
  feature: z.string(),
  /** Traces one request from the browser through the API into background jobs. */
  requestId: z.string().nullable(),
  userId: z.string().nullable(),
  companyId: z.string().nullable(),
  msg: z.string(),
  context: z.unknown().nullable(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

/** A page of the live tail: entries plus the cursor to ask for the next ones. */
export const logTailSchema = z.object({
  entries: z.array(logEntrySchema),
  nextCursor: z.string().nullable(),
});

export type LogTail = z.infer<typeof logTailSchema>;

/** Levels ordered most to least severe, for a "this level and above" filter. */
export const LOG_LEVEL_ORDER = logLevelSchema.options;
