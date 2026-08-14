// Author: Brijesh Dave <https://github.com/brijeshdave>
// Attachment repository — the only code touching the attachments table. Rows are
// metadata; the bytes are the storage layer's business.
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { attachments, users } from "@/core/db/schema.js";

export interface AttachmentRowRaw {
  id: string;
  companyId: string;
  ownerType: string;
  ownerId: string;
  filename: string;
  contentType: string;
  size: number;
  backend: string;
  key: string;
  checksum: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const cols = {
  id: attachments.id,
  companyId: attachments.companyId,
  ownerType: attachments.ownerType,
  ownerId: attachments.ownerId,
  filename: attachments.filename,
  contentType: attachments.contentType,
  size: attachments.size,
  backend: attachments.backend,
  key: attachments.key,
  checksum: attachments.checksum,
  uploadedBy: attachments.uploadedBy,
  uploadedByName: users.name,
  createdAt: attachments.createdAt,
  updatedAt: attachments.updatedAt,
};

function selectAttachments() {
  return db.select(cols).from(attachments).innerJoin(users, eq(users.id, attachments.uploadedBy));
}

/** The files on one record, oldest first — the order they were added. */
export async function attachmentsFor(
  ownerType: string,
  ownerId: string,
): Promise<AttachmentRowRaw[]> {
  return selectAttachments()
    .where(and(eq(attachments.ownerType, ownerType), eq(attachments.ownerId, ownerId)))
    .orderBy(asc(attachments.createdAt));
}

export async function getAttachment(id: string): Promise<AttachmentRowRaw | null> {
  const [row] = await selectAttachments().where(eq(attachments.id, id));
  return row ?? null;
}

export async function countFor(ownerType: string, ownerId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(attachments)
    .where(and(eq(attachments.ownerType, ownerType), eq(attachments.ownerId, ownerId)));
  return row?.count ?? 0;
}

export interface NewAttachment {
  companyId: string;
  ownerType: string;
  ownerId: string;
  filename: string;
  contentType: string;
  size: number;
  backend: string;
  key: string;
  checksum: string;
  uploadedBy: string;
}

export async function insertAttachment(values: NewAttachment): Promise<string> {
  const [row] = await db.insert(attachments).values(values).returning({ id: attachments.id });
  return row!.id;
}

export async function deleteAttachmentRow(id: string): Promise<void> {
  await db.delete(attachments).where(eq(attachments.id, id));
}

/** Every row still on `backend` — what `storage:migrate` has to move. */
export async function attachmentsOnBackend(backend: string): Promise<AttachmentRowRaw[]> {
  return selectAttachments()
    .where(eq(attachments.backend, backend))
    .orderBy(asc(attachments.createdAt));
}

/** Points a row at its new home once the bytes are safely there. */
export async function relocateAttachment(id: string, backend: string, key: string): Promise<void> {
  await db
    .update(attachments)
    .set({ backend, key, updatedAt: new Date() })
    .where(eq(attachments.id, id));
}
