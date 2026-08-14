// Author: Brijesh Dave <https://github.com/brijeshdave>
// Avatar repository — the only code touching user_avatars.
import { eq, inArray } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { userAvatars } from "@/core/db/schema.js";

export interface AvatarRow {
  contentType: string;
  bytes: Buffer;
  updatedAt: Date;
}

export async function getAvatar(userId: string): Promise<AvatarRow | null> {
  const [row] = await db
    .select({
      contentType: userAvatars.contentType,
      bytes: userAvatars.bytes,
      updatedAt: userAvatars.updatedAt,
    })
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId));
  return row ?? null;
}

export async function upsertAvatar(
  userId: string,
  contentType: string,
  bytes: Buffer,
): Promise<Date> {
  const updatedAt = new Date();
  await db
    .insert(userAvatars)
    .values({ userId, contentType, bytes, updatedAt })
    .onConflictDoUpdate({
      target: userAvatars.userId,
      set: { contentType, bytes, updatedAt },
    });
  return updatedAt;
}

export async function deleteAvatar(userId: string): Promise<void> {
  await db.delete(userAvatars).where(eq(userAvatars.userId, userId));
}

/**
 * Which of these users have a picture, and when it last changed.
 *
 * The bytes are deliberately not selected: a list of people must never drag every
 * image through the query. The timestamp is enough — it goes on the image URL as a
 * cache-buster, so a new picture appears at once and an unchanged one is served
 * from the browser's cache.
 */
export async function avatarVersions(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: userAvatars.userId, updatedAt: userAvatars.updatedAt })
    .from(userAvatars)
    .where(inArray(userAvatars.userId, userIds));
  return new Map(rows.map((row) => [row.userId, row.updatedAt.getTime()]));
}
