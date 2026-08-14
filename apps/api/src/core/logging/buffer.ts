// Author: Brijesh Dave <https://github.com/brijeshdave>
// Optional Redis log buffer. When enabled, sinks push lines onto a Redis list and
// a flusher drains them into the log database in batches, so a slow database can
// never back-pressure request handling. Disabled by default (direct writes).
import { getLoggingConfig } from "@/core/logging/config.js";
import { type LogRow, parseLogLine } from "@/core/logging/map.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";
import { redis } from "@/core/redis.js";

export const LOG_BUFFER_KEY = "logs:buffer";

const FLUSH_TICK_MS = 1000;

export async function pushLogLine(line: string): Promise<void> {
  try {
    await redis.rpush(LOG_BUFFER_KEY, line);
  } catch {
    // A failing buffer must never surface as an application error.
  }
}

/** Drain up to `batchSize` buffered lines into the log database. */
export async function flushLogBuffer(batchSize: number): Promise<number> {
  let lines: string[] | null;
  try {
    lines = await redis.lpop(LOG_BUFFER_KEY, batchSize);
  } catch {
    return 0;
  }
  if (!lines || lines.length === 0) return 0;

  const rows = lines.map(parseLogLine).filter((row): row is LogRow => row !== null);
  if (rows.length === 0) return 0;

  try {
    await logDb.insert(appLogs).values(rows);
  } catch {
    return 0;
  }
  return rows.length;
}

/** Start the periodic flusher; returns a stop function. Owned by the server. */
export function startLogBufferFlusher(): () => void {
  const timer = setInterval(() => {
    const { buffer } = getLoggingConfig();
    if (buffer.enabled) void flushLogBuffer(buffer.batchSize);
  }, FLUSH_TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
