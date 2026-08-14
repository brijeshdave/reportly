// Author: Brijesh Dave <https://github.com/brijeshdave>
// Redis client (cache, rate limiting, and better-auth secondary storage). Lazy
// connect so importing this never blocks boot; readiness checks reachability.
import { Redis } from "ioredis";

import { env } from "@/core/env.js";

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
});

// Surface connection errors to the log instead of crashing the process.
redis.on("error", () => {
  /* handled per-command; avoid unhandled 'error' events */
});

/** Ping Redis; returns true when reachable. */
export async function pingRedis(): Promise<boolean> {
  try {
    if (redis.status === "wait" || redis.status === "close" || redis.status === "end") {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}
