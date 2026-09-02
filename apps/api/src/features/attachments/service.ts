// Author: Brijesh Dave <https://github.com/brijeshdave>
// Attachment business logic: the limits, the authorization, and keeping the row and
// the bytes from disagreeing.
//
// Authorization is *delegated, never re-implemented*. Whether you may see a file is
// whether you may see the report it hangs off — asked by calling the reports
// service, not by copying its rule here. A visibility rule duplicated is a
// visibility rule that will drift, and the copy that drifts is the one that shows
// somebody a photo they should not have seen.
import { createHash } from "node:crypto";

import {
  type Attachment,
  type AttachmentOwnerType,
  ERROR_CODES,
  type StorageBackend,
  UPLOAD_LIMITS,
  type AuthContext,
} from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { activeStorage, newKey, storageFor } from "@/core/storage/index.js";
import {
  type AttachmentRowRaw,
  attachmentsFor,
  countFor,
  deleteAttachmentRow,
  getAttachment as getRow,
  insertAttachment,
} from "@/features/attachments/repo.js";
import { downlineUserIds } from "@/features/journal/hierarchy.js";
import { getReport } from "@/features/journal/service.js";
import { getTask } from "@/features/tasks/service.js";
import { companyOfCompletion, getCompletionById } from "@/features/routines/completion-repo.js";

function serialize(row: AttachmentRowRaw): Attachment {
  return {
    id: row.id,
    ownerType:
      row.ownerType === "task"
        ? "task"
        : row.ownerType === "routine-completion"
          ? "routine-completion"
          : "report",
    ownerId: row.ownerId,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    backend: (row.backend === "s3" ? "s3" : "local") as StorageBackend,
    checksum: row.checksum,
    uploadedBy: row.uploadedBy,
    uploadedByName: row.uploadedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Resolves the owning record, and answers both questions about it at once: may this
 * caller see it, and may they change it. `getReport` throws 404 when they may not
 * see it, so the visibility rule is enforced by the same code that enforces it for
 * the report itself.
 */
async function ownerOf(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  ctx: AuthContext,
): Promise<{ companyId: string; authorId: string; locked: boolean }> {
  if (ownerType === "task") {
    // Both services throw 404 rather than 403 when the caller may not see the
    // record, so a probe cannot use attachments to learn a task exists.
    const task = await getTask(ownerId, ctx);
    return {
      companyId: task.companyId,
      // Whoever is holding it is who the files belong to: they are doing the work,
      // and the brief the assigner wrote is theirs to add the photo to. A task
      // nobody has picked up yet belongs to whoever planned it.
      authorId: task.assignees.find((person) => !person.released)?.id ?? task.assignerId,
      // A task carries no appraisal, so nothing freezes its files.
      locked: false,
    };
  }
  if (ownerType === "routine-completion") {
    // The files belong to the person who did the occurrence — they attach the photo
    // of the done work. Scoped to the caller's active company.
    const completion = await getCompletionById(ownerId);
    const companyId = completion ? await companyOfCompletion(ownerId) : null;
    if (!completion || !companyId || companyId !== ctx.companyId) {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "Completion not found");
    }
    return { companyId, authorId: completion.userId, locked: false };
  }
  const report = await getReport(ownerId, ctx);
  return {
    companyId: report.companyId,
    authorId: report.authorId,
    locked: Boolean(report.lockedAt),
  };
}

/** The author, anyone above them in the line, or a superadmin — the same rule, and
 * the same walk, that downtime uses. */
async function assertMayWrite(authorId: string, ctx: AuthContext): Promise<void> {
  if (ctx.isSuperadmin || authorId === ctx.userId) return;
  const below = await downlineUserIds(ctx.userId);
  if (!below.has(authorId)) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "You cannot change files on this report");
  }
}

export async function listAttachments(
  ownerType: AttachmentOwnerType,
  ownerId: string,
  ctx: AuthContext,
): Promise<Attachment[]> {
  await ownerOf(ownerType, ownerId, ctx);
  return (await attachmentsFor(ownerType, ownerId)).map(serialize);
}

export interface UploadInput {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  filename: string;
  contentType: string;
  body: Buffer;
}

export async function upload(input: UploadInput, ctx: AuthContext): Promise<Attachment> {
  const owner = await ownerOf(input.ownerType, input.ownerId, ctx);
  await assertMayWrite(owner.authorId, ctx);

  // A file is part of what was appraised, so it follows the report's content lock —
  // unlike downtime, which is the machine's state carrying on in the real world and
  // must stay editable after a mark.
  if (owner.locked) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This report has been appraised and is locked. Re-open it to add files.",
    );
  }

  const limits = await getSystemSetting(UPLOAD_LIMITS);

  const maxBytes = limits.maxFileSizeMb * 1024 * 1024;
  if (input.body.length > maxBytes) {
    throw new AppError(
      413,
      ERROR_CODES.VALIDATION_ERROR,
      `That file is larger than the ${limits.maxFileSizeMb} MB limit`,
    );
  }
  if (input.body.length === 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That file is empty");
  }

  // Empty allowlist = accept anything, a decision an admin makes knowingly.
  if (limits.allowedTypes.length > 0 && !limits.allowedTypes.includes(input.contentType)) {
    throw new AppError(
      415,
      ERROR_CODES.VALIDATION_ERROR,
      `${input.contentType} files are not accepted here`,
      { allowedTypes: limits.allowedTypes },
    );
  }

  const existing = await countFor(input.ownerType, input.ownerId);
  if (existing >= limits.maxFilesPerOwner) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      `This report already has the maximum of ${limits.maxFilesPerOwner} files`,
    );
  }

  const storage = activeStorage();
  const key = newKey(input.ownerType, input.ownerId, input.filename);
  const checksum = createHash("sha256").update(input.body).digest("hex");

  await storage.put(key, input.body, input.contentType);

  let id: string;
  try {
    id = await insertAttachment({
      companyId: owner.companyId,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      filename: input.filename,
      contentType: input.contentType,
      size: input.body.length,
      backend: storage.name,
      key,
      checksum,
      uploadedBy: ctx.userId,
    });
  } catch (err) {
    // The bytes are written but nothing points at them. Take them back out, or the
    // store slowly fills with objects no row will ever name or clean up.
    await storage.delete(key).catch(() => undefined);
    throw err;
  }

  const row = await getRow(id);
  return serialize(row!);
}

/** The row plus its bytes, read from whichever backend it was written to. */
export async function download(
  id: string,
  ctx: AuthContext,
): Promise<{ attachment: Attachment; body: Buffer }> {
  const row = await getRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Attachment not found");

  // Seeing the file is seeing the record: this throws 404 if they may not.
  await ownerOf(row.ownerType as AttachmentOwnerType, row.ownerId, ctx);

  const attachment = serialize(row);
  const body = await storageFor(attachment.backend).get(row.key);
  return { attachment, body };
}

export async function remove(id: string, ctx: AuthContext): Promise<void> {
  const row = await getRow(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Attachment not found");

  const owner = await ownerOf(row.ownerType as AttachmentOwnerType, row.ownerId, ctx);
  await assertMayWrite(owner.authorId, ctx);
  if (owner.locked) {
    throw new AppError(
      409,
      ERROR_CODES.CONFLICT,
      "This report has been appraised and is locked. Re-open it to remove files.",
    );
  }

  // Row first: an orphaned object is invisible and cheap, an orphaned row is a
  // broken download link on somebody's screen.
  await deleteAttachmentRow(id);
  await storageFor(row.backend === "s3" ? "s3" : "local")
    .delete(row.key)
    .catch(() => undefined);
}
