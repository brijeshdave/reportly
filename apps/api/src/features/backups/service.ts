// Author: Brijesh Dave <https://github.com/brijeshdave>
// Taking, listing, pruning, downloading and deleting backups. A database backup is a
// pg_dump custom-format archive; a files backup is a tar.gz of the local upload store.
// Both are written through the storage layer (local dir or S3), so switching the backend
// moves backups off-box. Restore lives in restore.ts.
import { spawn } from "node:child_process";

import {
  BACKUP_KINDS,
  DATABASE_BACKUP_SETTINGS,
  ERROR_CODES,
  FILES_BACKUP_SETTINGS,
  type Backup,
  type BackupKind,
} from "@reportly/shared";

import { env } from "@/core/env.js";
import { AppError } from "@/core/errors.js";
import { notify } from "@/core/queue/notifications.js";
import { logger } from "@/core/logger.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { localRoot } from "@/core/storage/local.js";
import { activeStorage } from "@/core/storage/index.js";
import { isBackupDue, retentionCutoff } from "@/features/backups/config.js";
import {
  type BackupRow,
  deleteBackupRow,
  expiredBackups,
  getBackup,
  insertBackup,
  lastCompleted,
  listBackups as listBackupRows,
} from "@/features/backups/repo.js";

/** Run a command, capturing stdout as bytes and stderr as text. Never spawns a shell. */
export function runCapture(
  cmd: string,
  args: string[],
  stdin?: Buffer,
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code: code ?? 0, stdout: Buffer.concat(out), stderr: err }),
    );
    if (stdin) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

function serialize(row: BackupRow): Backup {
  return {
    id: row.id,
    kind: row.kind === "files" ? "files" : "database",
    status: row.status === "failed" ? "failed" : "completed",
    sizeBytes: row.sizeBytes,
    error: row.error,
    createdById: row.createdById,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listBackups(): Promise<Backup[]> {
  return (await listBackupRows()).map(serialize);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** The pg_dump/pg_restore invocation, argv-split so it can be a container exec. */
export const pgDumpArgv = (): string[] => env.PG_DUMP_CMD.trim().split(/\s+/);
export const pgRestoreArgv = (): string[] => env.PG_RESTORE_CMD.trim().split(/\s+/);

/** Take a database backup: pg_dump custom format → storage. Records a row either way. */
export async function runDatabaseBackup(by: string | null): Promise<Backup> {
  const key = `backups/db/${stamp()}.dump`;
  try {
    const [cmd, ...prefix] = pgDumpArgv();
    const { code, stdout, stderr } = await runCapture(cmd!, [
      ...prefix,
      "-Fc",
      "--no-owner",
      "--no-privileges",
      env.DATABASE_URL,
    ]);
    if (code !== 0) throw new Error(stderr.trim() || `pg_dump exited ${code}`);
    await activeStorage().put(key, stdout, "application/octet-stream");
    const id = await insertBackup({
      kind: "database",
      storageKey: key,
      sizeBytes: stdout.length,
      status: "completed",
      error: null,
      createdBy: by,
    });
    return serialize((await getBackup(id))!);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ feature: "backups", err: message }, "Database backup failed");
    const id = await insertBackup({
      kind: "database",
      storageKey: key,
      sizeBytes: 0,
      status: "failed",
      error: message.slice(0, 2000),
      createdBy: by,
    });
    // System-wide: a backup belongs to the installation, not a tenant, so this
    // reaches everyone holding backups:manage in any company.
    await notify({
      type: "backup.failed",
      companyId: null,
      actorUserId: by,
      title: "A database backup failed",
      body: message.slice(0, 500),
      link: "/backups",
      entityKind: "backup",
      entityId: id,
    });
    return serialize((await getBackup(id))!);
  }
}

/** Take a files backup: tar.gz of the local upload store → storage. Records a row either way. */
export async function runFilesBackup(by: string | null): Promise<Backup> {
  const key = `backups/files/${stamp()}.tar.gz`;
  try {
    if (env.STORAGE_BACKEND !== "local") {
      throw new Error(
        "File backups are only supported for the local upload store; S3 objects are already durable",
      );
    }
    const dir = localRoot(env.STORAGE_LOCAL_DIR);
    // `.` so the archive holds the store's contents at its root, not the absolute
    // path — and NOT the backups, which live under this same root.
    //
    // Without the exclusion every files backup swallows the ones before it: the
    // second contains the first, the third contains both, and the archive grows
    // exponentially over a store that never changed. Measured on a trivial
    // fixture it was already 5x the real content, and the multiple compounds with
    // each run until retention happens to prune it.
    //
    // It also makes a restore sane. Extracting an archive that carries its own
    // predecessors would rebuild a tree of stale backups beside the files you
    // actually wanted back.
    const { code, stdout, stderr } = await runCapture("tar", [
      "czf",
      "-",
      "-C",
      dir,
      "--exclude=./backups",
      ".",
    ]);
    if (code !== 0) throw new Error(stderr.trim() || `tar exited ${code}`);
    await activeStorage().put(key, stdout, "application/gzip");
    const id = await insertBackup({
      kind: "files",
      storageKey: key,
      sizeBytes: stdout.length,
      status: "completed",
      error: null,
      createdBy: by,
    });
    return serialize((await getBackup(id))!);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ feature: "backups", err: message }, "Files backup failed");
    const id = await insertBackup({
      kind: "files",
      storageKey: key,
      sizeBytes: 0,
      status: "failed",
      error: message.slice(0, 2000),
      createdBy: by,
    });
    // System-wide: a backup belongs to the installation, not a tenant, so this
    // reaches everyone holding backups:manage in any company.
    await notify({
      type: "backup.failed",
      companyId: null,
      actorUserId: by,
      title: "A files backup failed",
      body: message.slice(0, 500),
      link: "/backups",
      entityKind: "backup",
      entityId: id,
    });
    return serialize((await getBackup(id))!);
  }
}

export async function runBackup(kind: BackupKind, by: string | null): Promise<Backup> {
  return kind === "files" ? runFilesBackup(by) : runDatabaseBackup(by);
}

/** Delete every backup of a kind created before `cutoff` — storage object and row. */
export async function pruneBackups(kind: BackupKind, cutoff: Date): Promise<number> {
  const expired = await expiredBackups(kind, cutoff);
  for (const row of expired) {
    try {
      await activeStorage().delete(row.storageKey);
    } catch {
      // A missing object is fine — the row is what the catalogue shows; drop it too.
    }
    await deleteBackupRow(row.id);
  }
  return expired.length;
}

/** Load a backup's bytes for download. */
export async function downloadBackup(
  id: string,
): Promise<{ backup: Backup; body: Buffer; filename: string }> {
  const row = await getBackup(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Backup not found");
  if (row.status !== "completed") {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "That backup did not complete, so there is nothing to download",
    );
  }
  const body = await activeStorage().get(row.storageKey);
  const ext = row.kind === "files" ? "tar.gz" : "dump";
  return {
    backup: serialize(row),
    body,
    filename: `${row.kind}-${row.createdAt.toISOString().slice(0, 10)}.${ext}`,
  };
}

export async function deleteBackup(id: string): Promise<void> {
  const row = await getBackup(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Backup not found");
  try {
    await activeStorage().delete(row.storageKey);
  } catch {
    // Ignore a missing object; the row is the source of truth for the list.
  }
  await deleteBackupRow(id);
}

export const ALL_BACKUP_KINDS = BACKUP_KINDS;

/**
 * The scheduled sweep, run once a day by the worker: for each kind, take a backup if one
 * is due for its configured frequency, then prune to its retention. Failures are recorded
 * as failed rows inside `runBackup`, so the sweep itself never throws.
 */
export async function runScheduledBackups(now: Date = new Date()): Promise<void> {
  const kinds = [
    { kind: "database" as const, def: DATABASE_BACKUP_SETTINGS },
    { kind: "files" as const, def: FILES_BACKUP_SETTINGS },
  ];
  for (const { kind, def } of kinds) {
    const { frequency, retentionDays } = await getSystemSetting(def);
    const last = await lastCompleted(kind);
    if (isBackupDue(frequency, last?.createdAt ?? null, now)) {
      const result = await runBackup(kind, null);
      logger.info({ feature: "backups", kind, status: result.status }, "Scheduled backup ran");
    }
    const cutoff = retentionCutoff(retentionDays, now);
    if (cutoff) {
      const pruned = await pruneBackups(kind, cutoff);
      if (pruned > 0) logger.info({ feature: "backups", kind, pruned }, "Pruned expired backups");
    }
  }
}
