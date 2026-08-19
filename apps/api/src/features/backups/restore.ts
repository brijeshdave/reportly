// Author: Brijesh Dave <https://github.com/brijeshdave>
// Restoring from a backup — the destructive half. A database restore runs pg_restore
// --clean into the live database; a files restore unpacks a tar.gz back over the upload
// store. Superadmin only, single-flight, and the routes demand a typed confirmation.
// A DB restore drops and recreates objects, so it belongs in a quiet window.
import { ERROR_CODES, type AuthContext, type BackupKind } from "@reportly/shared";

import { env } from "@/core/env.js";
import { AppError } from "@/core/errors.js";
import { logger } from "@/core/logger.js";
import { activeStorage } from "@/core/storage/index.js";
import { localRoot } from "@/core/storage/local.js";
import {
  forwardPasswordThroughDocker,
  pgTarget,
  redactSecrets,
} from "@/features/backups/pg-connection.js";
import { pgRestoreArgv, runCapture } from "@/features/backups/service.js";
import { getBackup } from "@/features/backups/repo.js";

// One restore at a time across the process — a second would race the first's rewrite.
let restoreRunning = false;

function assertSuperadmin(ctx: AuthContext): void {
  if (!ctx.isSuperadmin) {
    throw new AppError(403, ERROR_CODES.FORBIDDEN, "Only a superadmin may restore a backup");
  }
}

async function withSingleFlight<T>(fn: () => Promise<T>): Promise<T> {
  if (restoreRunning) throw new AppError(409, ERROR_CODES.CONFLICT, "A restore is already running");
  restoreRunning = true;
  try {
    return await fn();
  } finally {
    restoreRunning = false;
  }
}

/** pg_restore the custom-format dump piped on stdin, replacing existing objects. */
async function restoreDatabaseDump(dump: Buffer): Promise<void> {
  const [cmd, ...prefix] = forwardPasswordThroughDocker(pgRestoreArgv());
  // Same as the dump side: connection by flags, password in the environment.
  const target = pgTarget(env.DATABASE_URL);
  const { code, stderr } = await runCapture(
    cmd!,
    [...prefix, "--clean", "--if-exists", "--no-owner", "--no-privileges", ...target.args],
    dump,
    target.childEnv,
  );
  if (code !== 0) {
    logger.error(
      { feature: "backups", stderr: redactSecrets(stderr).slice(0, 2000) },
      "Database restore failed",
    );
    throw new AppError(
      500,
      ERROR_CODES.INTERNAL_ERROR,
      `Restore failed: ${stderr.trim().slice(0, 500)}`,
    );
  }
}

/** Unpack a files archive over the local upload store. */
async function restoreFilesArchive(archive: Buffer): Promise<void> {
  if (env.STORAGE_BACKEND !== "local") {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "File restore is only supported for the local upload store",
    );
  }
  const dir = localRoot(env.STORAGE_LOCAL_DIR);
  const { code, stderr } = await runCapture("tar", ["xzf", "-", "-C", dir], archive);
  if (code !== 0) {
    logger.error(
      { feature: "backups", stderr: redactSecrets(stderr).slice(0, 2000) },
      "Files restore failed",
    );
    throw new AppError(
      500,
      ERROR_CODES.INTERNAL_ERROR,
      `File restore failed: ${stderr.trim().slice(0, 500)}`,
    );
  }
}

async function restore(kind: BackupKind, bytes: Buffer): Promise<void> {
  if (kind === "files") await restoreFilesArchive(bytes);
  else await restoreDatabaseDump(bytes);
}

/** Restore a stored backup by id. */
export async function restoreFromBackup(id: string, ctx: AuthContext): Promise<void> {
  assertSuperadmin(ctx);
  return withSingleFlight(async () => {
    const row = await getBackup(id);
    if (!row || row.status !== "completed") {
      throw new AppError(404, ERROR_CODES.NOT_FOUND, "No such completed backup");
    }
    const bytes = await activeStorage().get(row.storageKey);
    await restore(row.kind === "files" ? "files" : "database", bytes);
    logger.info({ feature: "backups", kind: row.kind, from: "stored" }, "Restore completed");
  });
}

/** Restore from an uploaded backup file (not one we stored). */
export async function restoreFromUpload(
  kind: BackupKind,
  bytes: Buffer,
  ctx: AuthContext,
): Promise<void> {
  assertSuperadmin(ctx);
  return withSingleFlight(async () => {
    await restore(kind, bytes);
    logger.info({ feature: "backups", kind, from: "upload" }, "Restore completed");
  });
}
