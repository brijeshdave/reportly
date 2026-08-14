// Author: Brijesh Dave <https://github.com/brijeshdave>
// Dropping every file on a record, for when the record itself goes.
//
// Its own module, not part of the attachments service, because the owning feature
// has to call it on delete and the attachments service already imports *that*
// feature to ask who may see what. Putting this beside the rest of the service would
// make the two import each other in a circle; a leaf module that depends only on the
// repository and the storage layer breaks it.
import { storageFor } from "@/core/storage/index.js";
import { attachmentsFor, deleteAttachmentRow } from "@/features/attachments/repo.js";
import type { StorageBackend } from "@reportly/shared";

/**
 * Removes the rows and then the bytes for one record's files.
 *
 * A failed object delete is swallowed on purpose: the row is already gone, so the
 * user sees the right thing, and what is left behind is an unreferenced object — a
 * bill, not a bug. Letting it throw would fail the delete of a report whose files
 * happened to be on an unreachable bucket.
 */
export async function removeAttachmentsFor(ownerType: string, ownerId: string): Promise<void> {
  for (const row of await attachmentsFor(ownerType, ownerId)) {
    await deleteAttachmentRow(row.id);
    const backend: StorageBackend = row.backend === "s3" ? "s3" : "local";
    await storageFor(backend)
      .delete(row.key)
      .catch(() => undefined);
  }
}
