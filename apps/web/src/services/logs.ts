// Author: Brijesh Dave <https://github.com/brijeshdave>
// Client log reporter. Browser errors enter the same pipeline as server logs and
// carry the same request id, so one trace spans browser -> API -> background jobs.
import type { LogLevel, LogTail } from "@reportly/shared";

import { http } from "@/services/http.js";

export interface ClientLogInput {
  level?: LogLevel;
  msg: string;
  context?: Record<string, unknown>;
}

/** Never throws: a failing log report must not break the UI it is reporting on. */
export async function reportClientLog(input: ClientLogInput): Promise<void> {
  try {
    await http.post("/logs/client", input);
  } catch {
    // swallow — the endpoint is rate-limited and best-effort
  }
}

/**
 * Poll for lines after `cursor`. The cursor is opaque and compares `(ts, id)` as
 * a tuple server-side, so rows sharing a timestamp are never skipped.
 */
export function fetchLogTail(cursor?: string, limit = 100): Promise<LogTail> {
  return http.get<LogTail>("/logs/tail", { query: { cursor, limit } });
}
