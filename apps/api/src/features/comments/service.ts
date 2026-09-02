// Author: Brijesh Dave <https://github.com/brijeshdave>
// The conversation on a report or a task.
//
// **Who may take part is not decided here.** It is delegated to the owning
// feature's own visibility rule — `reports.getReport` and `tasks.getTask`, both of
// which 404 when the caller may not see the record. That delegation is the whole
// design: it means "colleagues, the assignee, participants and everyone up the
// reporting line can discuss this" falls out for free and stays true when the
// visibility rule changes, instead of being a second copy that drifts. Attachments
// already work this way.
//
// So the rule is simply: **if you can open it, you can read and post on it.**
import {
  type AuthContext,
  type Comment,
  type CommentOwnerType,
  ERROR_CODES,
  PERMISSIONS,
  can,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import {
  commentsFor,
  deleteCommentRow,
  getComment,
  insertComment,
  updateCommentBody,
  type CommentRowRaw,
} from "@/features/comments/repo.js";
import { getReport } from "@/features/journal/service.js";
import { getTask } from "@/features/tasks/service.js";

/**
 * Resolve the owning record, enforcing its visibility on the way.
 *
 * Both services throw 404 rather than 403 when the caller may not see the record,
 * so comments cannot be used to probe whether a report exists.
 */
async function ownerOf(
  ownerType: CommentOwnerType,
  ownerId: string,
  ctx: AuthContext,
): Promise<{ companyId: string; ownerUserId: string | null; title: string }> {
  if (ownerType === "task") {
    const task = await getTask(ownerId, ctx);
    // The assignee, not the assigner: a remark on a task is aimed at whoever is
    // holding it — or at whoever planned it, while nobody is.
    return {
      companyId: task.companyId,
      ownerUserId: task.assignees.find((person) => !person.released)?.id ?? task.assignerId,
      title: task.title,
    };
  }
  // Note what is deliberately NOT checked: `lockedAt`. A report's content freezes
  // once appraised so a mark is never given for work that changed afterwards — but
  // a conversation is not the work, and a locked report is exactly when people most
  // need to discuss it. Same reasoning as downtime staying closable.
  const report = await getReport(ownerId, ctx);
  return { companyId: report.companyId, ownerUserId: report.authorId, title: report.title };
}

/**
 * May this caller rewrite this comment?
 *
 * Only their own, and only with `comments:update`. Authorship alone is not enough:
 * a comment on a report is part of the record of what happened, so changing it is
 * a right an administrator grants rather than something everyone has by virtue of
 * having typed it.
 *
 * There is deliberately no path to editing *somebody else's* — not for a
 * moderator, not for a superadmin. Removing a remark is a legitimate act;
 * rewriting one is putting words in another person's mouth.
 */
function mayEdit(row: CommentRowRaw, ctx: AuthContext): boolean {
  return row.authorId === ctx.userId && can(ctx, PERMISSIONS.COMMENTS_UPDATE);
}

/**
 * May this caller remove it? Their own with `comments:delete`, anybody's with
 * `comments:moderate`.
 */
function mayDelete(row: CommentRowRaw, ctx: AuthContext): boolean {
  if (can(ctx, PERMISSIONS.COMMENTS_MODERATE)) return true;
  return row.authorId === ctx.userId && can(ctx, PERMISSIONS.COMMENTS_DELETE);
}

function serialize(row: CommentRowRaw, ctx: AuthContext): Comment {
  return {
    id: row.id,
    ownerType: row.ownerType === "task" ? "task" : "report",
    ownerId: row.ownerId,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    parentId: row.parentId,
    editedAt: row.editedAt?.toISOString() ?? null,
    // Computed per caller from the same predicates the write paths enforce, so
    // what the UI offers and what the API allows cannot disagree.
    canEdit: mayEdit(row, ctx),
    canDelete: mayDelete(row, ctx),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listComments(
  ownerType: CommentOwnerType,
  ownerId: string,
  ctx: AuthContext,
): Promise<Comment[]> {
  await ownerOf(ownerType, ownerId, ctx);
  return (await commentsFor(ownerType, ownerId)).map((row) => serialize(row, ctx));
}

export async function addComment(
  ownerType: CommentOwnerType,
  ownerId: string,
  input: { body: string; parentId?: string },
  ctx: AuthContext,
): Promise<Comment> {
  const owner = await ownerOf(ownerType, ownerId, ctx);

  if (input.parentId) {
    const parent = await getComment(input.parentId);
    // A reply must belong to the same conversation. Without this check a caller
    // could thread a remark onto a record they cannot see, and the reply would
    // surface there.
    if (!parent || parent.ownerType !== ownerType || parent.ownerId !== ownerId) {
      throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That comment is not on this record");
    }
    // One level of threading. A reply to a reply flattens onto the same parent,
    // which keeps the UI honest rather than growing an unbounded tree nobody
    // designed a layout for.
    if (parent.parentId) input.parentId = parent.parentId;
  }

  const id = await insertComment({
    companyId: owner.companyId,
    ownerType,
    ownerId,
    authorId: ctx.userId,
    body: input.body,
    parentId: input.parentId ?? null,
  });
  const row = await getComment(id);

  // Only the record's own person, and never the commenter themselves — the
  // audience resolver drops the actor, so a note to yourself notifies nobody.
  if (ownerType === "report" && owner.ownerUserId) {
    await notify({
      type: "journal.commented",
      companyId: owner.companyId,
      actorUserId: ctx.userId,
      subjectUserId: owner.ownerUserId,
      title: `New comment on: ${owner.title}`,
      body: input.body,
      link: `/journal/${ownerId}`,
      entityKind: "journal",
      entityId: ownerId,
    });
  }

  return serialize(row!, ctx);
}

/** Your own words, and only with the right to change them. */
export async function editComment(id: string, body: string, ctx: AuthContext): Promise<Comment> {
  const row = await requireVisibleComment(id, ctx);
  if (!mayEdit(row, ctx)) {
    // Two different refusals, said differently, because the fix differs: one needs
    // a permission, the other is never available to anyone.
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      row.authorId === ctx.userId
        ? "You do not have permission to edit comments"
        : "A comment can only be edited by the person who wrote it",
    );
  }
  await updateCommentBody(id, body);
  return serialize((await getComment(id))!, ctx);
}

/** Your own with `comments:delete`, anybody's with `comments:moderate`. */
export async function removeComment(id: string, ctx: AuthContext): Promise<void> {
  const row = await requireVisibleComment(id, ctx);
  if (!mayDelete(row, ctx)) {
    throw new AppError(
      403,
      ERROR_CODES.FORBIDDEN,
      row.authorId === ctx.userId
        ? "You do not have permission to delete comments"
        : "You do not have permission to remove other people's comments",
    );
  }
  await deleteCommentRow(id);
}

/**
 * Fetch a comment and prove the caller may see the record it is on — a comment id
 * on its own says nothing about who may touch it.
 */
async function requireVisibleComment(id: string, ctx: AuthContext): Promise<CommentRowRaw> {
  const row = await getComment(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Comment not found");
  await ownerOf(row.ownerType === "task" ? "task" : "report", row.ownerId, ctx);
  return row;
}
