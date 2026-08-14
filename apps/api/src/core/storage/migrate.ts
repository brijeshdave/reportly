// Author: Brijesh Dave <https://github.com/brijeshdave>
// Moves existing attachments onto the configured backend.
//
// Switching STORAGE_BACKEND only changes where *new* files go — every existing row
// keeps the backend it was written to, and keeps working, because the location is
// stored per file rather than derived. This is what makes the switch complete.
//
// The order is the whole point: copy, verify, repoint, and only then delete the
// original. A move that deletes before it has proved the copy arrived is a move that
// loses somebody's evidence when the network blinks.
import { createHash } from "node:crypto";

import { env } from "@/core/env.js";
import { storageFor } from "@/core/storage/index.js";
import type { StorageProvider } from "@/core/storage/provider.js";
import { attachmentsOnBackend, relocateAttachment } from "@/features/attachments/repo.js";
import { STORAGE_BACKENDS, type StorageBackend } from "@reportly/shared";

export interface MigrateResult {
  moved: number;
  skipped: number;
  failed: { id: string; filename: string; reason: string }[];
}

export interface MigrateOptions {
  /** JournalEntry what would happen and change nothing. */
  dryRun?: boolean;
  /** Where files should end up. Defaults to the configured backend. */
  target?: StorageBackend;
  onProgress?: (message: string) => void;
  /**
   * How a backend name becomes a provider. Defaults to the real one; the seam
   * exists so the move can be tested against two stand-in backends, since the
   * ordering here (verify before repoint, repoint before delete) is the part worth
   * proving and it should not need a live bucket to prove it.
   */
  resolve?: (backend: StorageBackend) => StorageProvider;
}

export async function migrateStorage(options: MigrateOptions = {}): Promise<MigrateResult> {
  const target = options.target ?? env.STORAGE_BACKEND;
  const say = options.onProgress ?? (() => undefined);
  const resolve = options.resolve ?? storageFor;
  const result: MigrateResult = { moved: 0, skipped: 0, failed: [] };

  const sources = STORAGE_BACKENDS.filter((backend) => backend !== target);
  const destination = resolve(target);

  for (const source of sources) {
    const rows = await attachmentsOnBackend(source);
    if (rows.length === 0) continue;
    say(`${rows.length} file(s) on ${source} to move to ${target}`);

    for (const row of rows) {
      try {
        const from = resolve(source);
        const body = await from.get(row.key);

        // The checksum was recorded at upload. If the bytes we just read do not
        // match it, the file was already damaged — copying it on would launder a
        // corrupt object into the new backend and call it a success.
        const actual = createHash("sha256").update(body).digest("hex");
        if (actual !== row.checksum) {
          result.failed.push({
            id: row.id,
            filename: row.filename,
            reason: `checksum mismatch at source (expected ${row.checksum.slice(0, 12)}…, read ${actual.slice(0, 12)}…)`,
          });
          continue;
        }

        if (options.dryRun) {
          say(`  would move ${row.filename} (${row.key})`);
          result.skipped += 1;
          continue;
        }

        await destination.put(row.key, body, row.contentType);

        // Read it back from the far end. `put` resolving means the request was
        // accepted, not that the object is retrievable and intact.
        const written = await destination.get(row.key);
        if (createHash("sha256").update(written).digest("hex") !== row.checksum) {
          result.failed.push({
            id: row.id,
            filename: row.filename,
            reason: "copy did not verify at the destination; original left in place",
          });
          continue;
        }

        // Only now does the row point at the new home, and only then is the old
        // copy removed. Between these two lines both copies exist, which is the
        // safe place to be interrupted.
        await relocateAttachment(row.id, target, row.key);
        await from.delete(row.key).catch(() => undefined);

        result.moved += 1;
        say(`  moved ${row.filename}`);
      } catch (err) {
        result.failed.push({
          id: row.id,
          filename: row.filename,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}
