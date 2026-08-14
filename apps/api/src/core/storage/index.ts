// Author: Brijesh Dave <https://github.com/brijeshdave>
// Resolves storage backends. Uploads use `activeStorage()` (what the env selects);
// reads use `storageFor(row.backend)`, because a file is read from wherever it was
// written, not from wherever new files go today. That distinction is the whole
// reason switching STORAGE_BACKEND does not orphan the existing files.
import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { env } from "@/core/env.js";
import { LocalStorage, localRoot } from "@/core/storage/local.js";
import type { StorageProvider } from "@/core/storage/provider.js";
import { S3Storage } from "@/core/storage/s3.js";
import type { StorageBackend } from "@reportly/shared";

const cache = new Map<StorageBackend, StorageProvider>();

/** The provider for a named backend, built once. */
export function storageFor(backend: StorageBackend): StorageProvider {
  const existing = cache.get(backend);
  if (existing) return existing;

  let provider: StorageProvider;
  if (backend === "local") {
    provider = new LocalStorage(localRoot(env.STORAGE_LOCAL_DIR));
  } else {
    // env.ts refuses to start when s3 is selected without a bucket, so by the time a
    // caller asks for it the configuration is complete. A row that names `s3` on an
    // install configured for local is the one case left, and it should say so.
    if (!env.S3_BUCKET) {
      throw new Error(
        "An attachment is stored in S3 but S3_BUCKET is not configured on this install.",
      );
    }
    provider = new S3Storage({
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }

  cache.set(backend, provider);
  return provider;
}

/** Where new uploads go. */
export function activeStorage(): StorageProvider {
  return storageFor(env.STORAGE_BACKEND);
}

/**
 * The key a new upload gets. Server-generated, never the uploader's filename: two
 * people attach `photo.jpg` on the same day, and a filename from a browser is
 * attacker-controlled text that would be deciding a path. The original name is kept
 * in the row for display, and the extension is carried only so a downloaded file
 * opens in the right thing.
 */
export function newKey(ownerType: string, ownerId: string, filename: string): string {
  const ext = extname(filename).slice(0, 12).toLowerCase();
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : "";
  return `${ownerType}/${ownerId}/${randomUUID()}${safeExt}`;
}
