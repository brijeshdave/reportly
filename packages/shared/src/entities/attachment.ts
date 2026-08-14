// Author: Brijesh Dave <https://github.com/brijeshdave>
// A file hanging off something — the photo of the broken belt, the vendor's report.
//
// The row is metadata only; the bytes live in whichever storage backend was
// configured when it was uploaded. `backend` and `key` are recorded per file rather
// than derived from today's configuration, because a file uploaded to local disk
// stays on local disk when the backend is switched to S3 — until `storage:migrate`
// moves it and rewrites the row. Deriving the location would lose every old file the
// moment the setting changed.
import { z } from "zod";

import { timestampsSchema, uuidSchema } from "@/entities/common.js";

/** What an attachment can hang off. Tasks arrive with the tasks feature. */
export const ATTACHMENT_OWNER_TYPES = ["report", "task", "routine-completion"] as const;
export type AttachmentOwnerType = (typeof ATTACHMENT_OWNER_TYPES)[number];
export const attachmentOwnerTypeSchema = z.enum(ATTACHMENT_OWNER_TYPES);

/** Where the bytes are. Recorded per file — see the note at the top. */
export const STORAGE_BACKENDS = ["local", "s3"] as const;
export type StorageBackend = (typeof STORAGE_BACKENDS)[number];
export const storageBackendSchema = z.enum(STORAGE_BACKENDS);

/**
 * An attachment as the API returns it.
 *
 * The storage **key** is deliberately not here. It is an internal path in a bucket a
 * client can never address, and telling every reader where the bytes physically sit
 * buys nothing. The `backend` stays: an operator wants to see, in the UI, that a
 * file is still on local disk after switching to S3.
 */
export const attachmentSchema = z
  .object({
    id: uuidSchema,
    ownerType: attachmentOwnerTypeSchema,
    ownerId: uuidSchema,
    /** The name the uploader's file had. Display only — never a path. */
    filename: z.string(),
    contentType: z.string(),
    size: z.number().int(),
    backend: storageBackendSchema,
    /** sha256 of the bytes, so a migration between backends can prove it moved them. */
    checksum: z.string(),
    uploadedBy: z.string(),
    uploadedByName: z.string(),
  })
  .merge(timestampsSchema);
export type Attachment = z.infer<typeof attachmentSchema>;
