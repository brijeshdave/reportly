// Author: Brijesh Dave <https://github.com/brijeshdave>
// Working together on a record: the conversation on it, who currently holds it,
// who worked it, and the trail of it changing hands.
import { z } from "zod";

import { nameSchema, timestampsSchema, uuidSchema } from "@/entities/common.js";

/**
 * What a comment can hang off. The same two owners tags and attachments use, and
 * the same `ownerType` + `ownerId` shape — one conversation feature, not one per
 * kind of record.
 */
export const COMMENT_OWNER_TYPES = ["report", "task"] as const;
export type CommentOwnerType = (typeof COMMENT_OWNER_TYPES)[number];
export const commentOwnerTypeSchema = z.enum(COMMENT_OWNER_TYPES);

/** Long enough for a real explanation, short enough not to be a document. */
const commentBody = z.string().trim().min(1).max(10000);

export const commentSchema = z
  .object({
    id: uuidSchema,
    ownerType: commentOwnerTypeSchema,
    ownerId: uuidSchema,
    authorId: z.string(),
    authorName: nameSchema,
    body: z.string(),
    parentId: uuidSchema.nullable(),
    /** Set once the author revises it — so a reader can tell an edited remark from
     *  the one people replied to. */
    editedAt: z.string().datetime().nullable(),
    /** Whether *this* caller may edit or delete it. Computed per request rather
     *  than inferred in the browser from ids, so the UI and the API cannot
     *  disagree about who owns a remark. */
    canEdit: z.boolean(),
    canDelete: z.boolean(),
  })
  .merge(timestampsSchema);
export type Comment = z.infer<typeof commentSchema>;

export const createCommentSchema = z.object({
  body: commentBody,
  /** Reply to another comment on the same record. One level only. */
  parentId: uuidSchema.optional(),
});
export type CreateComment = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({ body: commentBody });
export type UpdateComment = z.infer<typeof updateCommentSchema>;

/* ------------------------------- participants ------------------------------ */

/**
 * Somebody who worked the report — the membership list.
 *
 * This says *who* took part; how many points each earns is scored separately (see
 * the scoring grid). Being named here is what puts a worker in the grid.
 */
/**
 * One piece of work, by one person, at a time.
 *
 * The entry keeps `workSummary`/`workDetail` as a roll-up so the reports and exports
 * carry on reading one field, but this is the record: a job worked over two shifts is
 * several of these, each owned by whoever did it. One text column had nowhere to put
 * a *when*, and appending to it turned a history into a run-on paragraph.
 */
export const workLogSchema = z.object({
  id: uuidSchema,
  reportId: uuidSchema,
  userId: z.string(),
  userName: z.string(),
  summary: z.string(),
  detail: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  /** When it was written down, which is often later than when it was done. */
  createdAt: z.string().datetime(),
  /** Whether the caller may edit or remove this item — their own, or a superadmin. */
  canEdit: z.boolean(),
});
export type WorkLog = z.infer<typeof workLogSchema>;

/**
 * One piece of work as somebody writes it down.
 *
 * Everything is required, which is a deliberate tightening. The times were optional
 * "but worth filling in", and what that produced was a timeline of items with no
 * *when* — which is the one thing the timeline exists to carry, and the thing a single
 * text column could not hold. An item with no hours cannot be read as a shift, cannot
 * be ordered against a colleague's, and gives the points split nothing to weigh.
 */
export const createWorkLogSchema = z
  .object({
    summary: z.string().trim().min(1, "Say what you did, in a line.").max(300),
    detail: z
      .string()
      .trim()
      .min(1, "Describe what you did — this is the record somebody reads later.")
      .max(5000),
    startedAt: z.string().datetime("Say when you started."),
    finishedAt: z.string().datetime("Say when you finished."),
  })
  .refine((value) => value.finishedAt >= value.startedAt, {
    message: "Finished before it started",
    path: ["finishedAt"],
  })
  // Work that has not happened yet is not a record of work. A minute of tolerance,
  // because a clock a few seconds ahead should not refuse somebody's honest entry.
  .refine((value) => new Date(value.finishedAt).getTime() <= Date.now() + 60_000, {
    message: "That is in the future — say when you actually finished.",
    path: ["finishedAt"],
  });
export type CreateWorkLog = z.infer<typeof createWorkLogSchema>;

export const updateWorkLogSchema = createWorkLogSchema;
export type UpdateWorkLog = z.infer<typeof updateWorkLogSchema>;

export const journalParticipantSchema = z.object({
  userId: z.string(),
  userName: nameSchema,
  addedById: z.string(),
  addedByName: nameSchema,
  addedAt: z.string().datetime(),
});
export type JournalParticipant = z.infer<typeof journalParticipantSchema>;

/** Set who worked a report — the membership list. Points are scored separately. */
export const setParticipantsSchema = z.object({
  participants: z.array(z.object({ userId: z.string() })),
});
export type SetParticipants = z.infer<typeof setParticipantsSchema>;

/* --------------------------------- handover -------------------------------- */

/** One change of hands. Append-only — see the table's note. */
export const journalHandoverSchema = z.object({
  id: uuidSchema,
  reportId: uuidSchema,
  fromUserId: z.string().nullable(),
  fromUserName: nameSchema.nullable(),
  toUserId: z.string().nullable(),
  toUserName: nameSchema.nullable(),
  byUserId: z.string(),
  byUserName: nameSchema,
  reason: z.string().nullable(),
  handedAt: z.string().datetime(),
});
export type JournalHandover = z.infer<typeof journalHandoverSchema>;

export const assignJournalEntrySchema = z.object({
  /** Null hands it back to nobody — a real state, not an error: work can be put
   *  down before anyone else picks it up. */
  assigneeId: z.string().nullable(),
  reason: z.string().trim().max(500).optional(),
});
export type AssignJournalEntry = z.infer<typeof assignJournalEntrySchema>;
