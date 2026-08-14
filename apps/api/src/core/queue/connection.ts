// Author: Brijesh Dave <https://github.com/brijeshdave>
// BullMQ connection options derived from REDIS_URL. BullMQ owns its own clients,
// so queues/workers never share the app's Redis client.
import type { ConnectionOptions } from "bullmq";

import { env } from "@/core/env.js";

export function queueConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  // Honour the database index in the URL path (tests use a dedicated db).
  const database = Number(url.pathname.replace("/", "")) || 0;
  return {
    db: database,
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    // BullMQ requires this to be null.
    maxRetriesPerRequest: null,
  };
}
