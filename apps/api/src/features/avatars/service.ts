// Author: Brijesh Dave <https://github.com/brijeshdave>
// Profile pictures: accept an image, prove it is one, store it, serve it back.
//
// The browser resizes to 256px before uploading, so what arrives here is tens of
// kilobytes. The cap below is the backstop for a caller that is not our browser.
import { ERROR_CODES } from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { deleteAvatar, getAvatar, upsertAvatar, type AvatarRow } from "@/features/avatars/repo.js";

/** Comfortably above a 256px image, far below anything worth storing in a row. */
const MAX_BYTES = 512 * 1024;

/**
 * What the bytes actually are, read from their leading magic number — never from
 * the `Content-Type` the caller claimed. A declared type is a request, not
 * evidence: a `.png` that is really an HTML document, served back with a type we
 * were told rather than one we checked, is a stored cross-site scripting bug.
 */
function sniff(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Store a picture for a user. Returns the version stamp the image URL carries. */
export async function setAvatar(userId: string, base64: string): Promise<number> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That is not a readable image");
  }

  if (bytes.length === 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "That image is empty");
  }
  if (bytes.length > MAX_BYTES) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      `That image is too large (max ${Math.round(MAX_BYTES / 1024)} KB)`,
    );
  }

  const contentType = sniff(bytes);
  if (!contentType) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Only PNG, JPEG and WebP images are accepted",
    );
  }

  const updatedAt = await upsertAvatar(userId, contentType, bytes);
  return updatedAt.getTime();
}

export async function readAvatar(userId: string): Promise<AvatarRow | null> {
  return getAvatar(userId);
}

export async function removeAvatar(userId: string): Promise<void> {
  await deleteAvatar(userId);
}
