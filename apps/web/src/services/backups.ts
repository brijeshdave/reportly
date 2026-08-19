// Author: Brijesh Dave <https://github.com/brijeshdave>
// Backup calls: list them, take one now, download the artifact, delete one. The schedule
// and retention are ordinary settings (Settings → Backups).
import type { Backup, BackupKind } from "@reportly/shared";

import { download, http } from "@/services/http.js";

export const fetchBackups = () => http.get<Backup[]>("/backups");

export const runBackup = (kind: BackupKind) =>
  http.post<Backup>("/backups", {}, { query: { kind } });

export const downloadBackup = (id: string, filename: string) =>
  download(`/backups/${id}/download`, filename);

/** What one attempt said, as a .log file. */
export const downloadBackupLog = (id: string, filename: string) =>
  download(`/backups/${id}/log`, filename);

export const deleteBackup = (id: string) => http.delete<void>(`/backups/${id}`);

/** Restore a stored backup — destructive, superadmin-only, needs the RESTORE confirmation. */
export const restoreBackup = (id: string) =>
  http.post<{ ok: true }>(`/backups/${id}/restore`, { confirm: "RESTORE" });

/** Restore from an uploaded backup file — same guards. */
export const restoreUpload = (kind: BackupKind, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<{ ok: true }>("/backups/restore/upload", form, {
    query: { kind, confirm: "RESTORE" },
  });
};
