// Author: Brijesh Dave <https://github.com/brijeshdave>
// The local-disk backend. Fine for a single-node install and for development; note
// the container runs on a read-only root filesystem, so STORAGE_LOCAL_DIR has to be
// a mounted volume. S3 is the clean path for anything with more than one node.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type { StorageProvider } from "@/core/storage/provider.js";
import type { StorageBackend } from "@reportly/shared";

/**
 * Maps an object key to a path *inside* the root, and refuses anything that climbs
 * out of it.
 *
 * Keys are server-generated today, so this cannot currently be reached — which is
 * exactly why it is here. The check costs nothing, and the day a key comes from
 * somewhere else, `../../etc/passwd` should already have been a dead end rather than
 * a new thing to remember.
 */
function pathFor(root: string, key: string): string {
  const full = resolve(root, key);
  const rootResolved = resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) {
    throw new Error(`Refusing a storage key that escapes the storage root: ${key}`);
  }
  return full;
}

export class LocalStorage implements StorageProvider {
  readonly name: StorageBackend = "local";

  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer): Promise<void> {
    const path = pathFor(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(pathFor(this.root, key));
  }

  async delete(key: string): Promise<void> {
    // force: already gone is the outcome the caller wanted.
    await rm(pathFor(this.root, key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(pathFor(this.root, key));
      return true;
    } catch {
      return false;
    }
  }
}

/** sha256 of the bytes — how a migration proves it moved what it thought it did. */
export function checksumOf(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

/** The on-disk root, resolved once. */
export function localRoot(dir: string): string {
  return join(process.cwd(), dir);
}
