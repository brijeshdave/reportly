// Author: Brijesh Dave <https://github.com/brijeshdave>
// What a report is *about* — its scope. A report may point at any mix of assets,
// devices, users and departments, or at nothing at all: some work relates to no
// particular thing and only needs recording. Scope is polymorphic (a kind + an id)
// rather than four nullable columns, so adding a target kind later costs nothing,
// and it drives roll-up analytics ("every issue under Line 3, including its
// devices") without forcing anything into a hand-built tree.
import { z } from "zod";

/** The kinds of thing a report can be scoped to. */
export const TARGET_KINDS = ["asset", "device", "user", "department"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];
export const targetKindSchema = z.enum(TARGET_KINDS);

/** One scope link as sent in — a kind and the id of the thing. */
export const reportTargetInputSchema = z.object({
  kind: targetKindSchema,
  id: z.string().min(1),
});
export type JournalTargetInput = z.infer<typeof reportTargetInputSchema>;

/** One scope link as read back — resolved to a human label for display. */
export const journalTargetSchema = z.object({
  kind: targetKindSchema,
  id: z.string(),
  label: z.string(),
  /**
   * Whether an outage on this thing is worth recording — its TYPE's answer.
   *
   * Sent with the target rather than worked out by the screen: the type lives
   * two joins away, and a browser that had to fetch every asset type and device
   * type to decide whether to offer a downtime button would be re-deriving
   * something the server already knew. People and departments are never down.
   */
  tracksDowntime: z.boolean(),
});
export type JournalTarget = z.infer<typeof journalTargetSchema>;
