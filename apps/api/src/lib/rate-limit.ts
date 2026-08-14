// Author: Brijesh Dave <https://github.com/brijeshdave>
// Small Redis fixed-window rate limiter for non-auth routes (better-auth handles
// its own endpoints). Fails open: if Redis is unavailable we allow the request
// rather than take the API down.
import { ERROR_CODES } from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { redis } from "@/core/redis.js";

export async function consumeRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  let count: number;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
  } catch {
    return; // fail open
  }
  if (count > max) {
    throw new AppError(429, ERROR_CODES.RATE_LIMITED, "Too many requests, slow down");
  }
}
