// Author: Brijesh Dave <https://github.com/brijeshdave>
// Backups — recorded database dumps and file archives. Each is taken through the storage
// layer (local dir or S3), on its own schedule with its own retention, and can be
// downloaded or restored. The registry entries for the per-kind schedule/retention live
// in settings/registry.ts; this file is the record shape the Backups page reads.
import { z } from "zod";

import { uuidSchema } from "@/entities/common.js";

export const BACKUP_KINDS = ["database", "files"] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];
export const backupKindSchema = z.enum(BACKUP_KINDS);

export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  database: "Database",
  files: "Files",
};

export const BACKUP_STATUSES = ["completed", "failed"] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const backupSchema = z.object({
  id: uuidSchema,
  kind: backupKindSchema,
  status: z.enum(BACKUP_STATUSES),
  /** Bytes of the artifact (0 for a failed run). */
  sizeBytes: z.number().int().nonnegative(),
  /** Why a run failed, when it did. */
  error: z.string().nullable(),
  /** Who ran it — null for the scheduled job. */
  createdById: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type Backup = z.infer<typeof backupSchema>;
