// Author: Brijesh Dave <https://github.com/brijeshdave>
// The storage seam. Everything that stores bytes goes through this interface, so a
// backend is swapped by configuration and `storage:migrate` can move files between
// two of them without knowing what either one is.
//
// Deliberately four methods. Anything richer (presigned URLs, ranged reads, listing)
// is an S3 idea that local disk would have to fake, and a seam only holds while both
// sides can honour it honestly.
import type { StorageBackend } from "@reportly/shared";

export interface StorageProvider {
  /** Which backend this is — recorded on every row it writes. */
  readonly name: StorageBackend;

  /** Writes bytes at `key`, overwriting whatever was there. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;

  /**
   * Reads the whole object. A stream would be better for a large file, but every
   * caller here either hashes it or ships it, and both want it whole; a streaming
   * read is worth adding when there is a caller that streams.
   */
  get(key: string): Promise<Buffer>;

  /** Removes the object. Deleting what is not there is not an error. */
  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}
