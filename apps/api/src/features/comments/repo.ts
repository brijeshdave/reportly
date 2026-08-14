// Author: Brijesh Dave <https://github.com/brijeshdave>
// The only code touching the comments table.
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { comments, users } from "@/core/db/schema.js";

export interface CommentRowRaw {
  id: string;
  companyId: string;
  ownerType: string;
  ownerId: string;
  authorId: string;
  authorName: string;
  body: string;
  parentId: string | null;
  editedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const cols = {
  id: comments.id,
  companyId: comments.companyId,
  ownerType: comments.ownerType,
  ownerId: comments.ownerId,
  authorId: comments.authorId,
  authorName: users.name,
  body: comments.body,
  parentId: comments.parentId,
  editedAt: comments.editedAt,
  createdAt: comments.createdAt,
  updatedAt: comments.updatedAt,
};

/**
 * A record's conversation, oldest first — reading order. Threading is assembled by
 * the caller from `parentId`, the same way the asset and department trees are
 * built from theirs.
 */
export async function commentsFor(ownerType: string, ownerId: string): Promise<CommentRowRaw[]> {
  return db
    .select(cols)
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(and(eq(comments.ownerType, ownerType), eq(comments.ownerId, ownerId)))
    .orderBy(asc(comments.createdAt));
}

export async function getComment(id: string): Promise<CommentRowRaw | null> {
  const [row] = await db
    .select(cols)
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.id, id));
  return row ?? null;
}

export async function insertComment(values: {
  companyId: string;
  ownerType: string;
  ownerId: string;
  authorId: string;
  body: string;
  parentId: string | null;
}): Promise<string> {
  const [row] = await db.insert(comments).values(values).returning({ id: comments.id });
  return row!.id;
}

/** Editing stamps `editedAt`, so a revised remark is visibly revised. */
export async function updateCommentBody(id: string, body: string): Promise<void> {
  await db
    .update(comments)
    .set({ body, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(comments.id, id));
}

/** Replies cascade with the parent — a thread's answers make no sense without it. */
export async function deleteCommentRow(id: string): Promise<void> {
  await db.delete(comments).where(eq(comments.id, id));
}

/** Every comment on a record — used when the record itself is deleted, since the
 *  owner link is polymorphic and carries no foreign key to cascade through. */
export async function deleteCommentsFor(ownerType: string, ownerId: string): Promise<void> {
  await db
    .delete(comments)
    .where(and(eq(comments.ownerType, ownerType), eq(comments.ownerId, ownerId)));
}
