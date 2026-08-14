// Author: Brijesh Dave <https://github.com/brijeshdave>
// Maps a serialized pino line onto an app_logs row. Shared by the direct
// log-database sink and the Redis-buffer flusher so both persist identical rows.
interface PinoLine {
  level?: string;
  time?: string;
  msg?: string;
  reqId?: string;
  feature?: string;
  userId?: string;
  companyId?: string;
  [key: string]: unknown;
}

export interface LogRow {
  ts?: Date;
  level: string;
  feature: string;
  requestId: string | null;
  userId: string | null;
  companyId: string | null;
  msg: string;
  context: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseLogLine(line: string): LogRow | null {
  let parsed: PinoLine;
  try {
    parsed = JSON.parse(line) as PinoLine;
  } catch {
    return null;
  }

  const { level, time, msg, reqId, feature, userId, companyId, ...context } = parsed;
  return {
    ...(time ? { ts: new Date(time) } : {}),
    level: level ?? "info",
    feature: feature ?? "api",
    requestId: reqId ?? null,
    userId: userId ?? null,
    companyId: companyId && UUID_RE.test(companyId) ? companyId : null,
    msg: msg ?? "",
    context: Object.keys(context).length > 0 ? context : null,
  };
}
