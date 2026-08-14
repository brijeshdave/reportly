// Author: Brijesh Dave <https://github.com/brijeshdave>
// Turning a stored log line into something readable. The rich detail lives in the
// `context` jsonb — an HTTP request records its method, url, status and timing
// there — but a bare row only ever showed "incoming request". These pull that
// structure back out, and are shared by the table, the detail view and the
// terminal tail so all three describe a line the same way.
import type { LogEntry, LogLevel } from "@reportly/shared";

type Ctx = Record<string, unknown>;

function asObject(value: unknown): Ctx | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Ctx) : null;
}

export interface RequestSummary {
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
}

/**
 * The HTTP shape of a line, pulled from the several context layouts pino and our
 * debug summary produce. Null when the line is not about a request.
 */
export function requestSummary(entry: LogEntry): RequestSummary | null {
  const ctx = asObject(entry.context);
  if (!ctx) return null;

  const req = asObject(ctx.req);
  const res = asObject(ctx.res);

  const method = (req?.method ?? ctx.method) as string | undefined;
  const url = (req?.url ?? ctx.url) as string | undefined;
  const status = (res?.statusCode ?? ctx.statusCode) as number | undefined;
  const durationRaw = (ctx.responseTimeMs ?? ctx.responseTime) as number | undefined;
  const durationMs = typeof durationRaw === "number" ? Math.round(durationRaw) : undefined;

  if (method === undefined && url === undefined && status === undefined) return null;
  return { method, url, status, durationMs };
}

/** A one-line human description of a request summary, e.g. `GET /users → 200 · 11ms`. */
export function formatRequestSummary(summary: RequestSummary): string {
  const parts: string[] = [];
  if (summary.method) parts.push(summary.method);
  if (summary.url) parts.push(summary.url);
  const tail: string[] = [];
  if (summary.status !== undefined) tail.push(`→ ${summary.status}`);
  if (summary.durationMs !== undefined) tail.push(`· ${summary.durationMs}ms`);
  return [parts.join(" "), tail.join(" ")].filter(Boolean).join(" ");
}

/** The context minus the fields already surfaced elsewhere, for the detail view. */
export function extraContext(entry: LogEntry): Ctx | null {
  const ctx = asObject(entry.context);
  if (!ctx) return null;
  const { pid, hostname, ...rest } = ctx;
  void pid;
  void hostname;
  return Object.keys(rest).length > 0 ? rest : null;
}

/** Log levels ordered from most to least severe, for the level selector. */
export const LEVEL_SEVERITY: Record<string, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

/** Semantic tone for a level, shared by the badge and the terminal colours. */
export function levelTone(level: string): "danger" | "warning" | "info" | "muted" {
  if (level === "fatal" || level === "error") return "danger";
  if (level === "warn") return "warning";
  if (level === "info") return "info";
  return "muted";
}

/** Terminal text colour per level — literal classes so Tailwind keeps them. */
export const LEVEL_TERMINAL_CLASS: Record<string, string> = {
  fatal: "text-red-400",
  error: "text-red-400",
  warn: "text-amber-300",
  info: "text-sky-300",
  debug: "text-slate-400",
  trace: "text-slate-500",
};

export function terminalLevelClass(level: LogLevel | string): string {
  return LEVEL_TERMINAL_CLASS[level] ?? "text-slate-300";
}

/**
 * Pill colours for a level badge in a table — a distinct colour per level so the
 * severity of a line reads at a glance, rather than every level looking the same.
 * Literal classes, both modes, so Tailwind's scanner keeps them.
 */
export const LEVEL_PILL_CLASS: Record<string, string> = {
  fatal: "bg-red-600 text-white",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  debug: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  trace: "bg-slate-400/10 text-slate-500 dark:text-slate-400",
};

export function levelPillClass(level: LogLevel | string): string {
  return LEVEL_PILL_CLASS[level] ?? "bg-muted text-muted-foreground";
}
