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
