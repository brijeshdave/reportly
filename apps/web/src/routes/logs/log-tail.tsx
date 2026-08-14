// Author: Brijesh Dave <https://github.com/brijeshdave>
// The live tail, as a console. Lines arrive newest-at-the-bottom and the view
// sticks to the bottom the way a terminal does — unless you have scrolled up to
// read, in which case it leaves you where you are. Colour comes from the level, so
// an error is visible at a glance in a stream of info. Polling, not sockets: the
// interval is yours to choose, and pausing stops it entirely.
import { LOG_LEVELS, type LogEntry, type LogLevel } from "@reportly/shared";
import { Pause, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";
import {
  LEVEL_SEVERITY,
  formatRequestSummary,
  requestSummary,
  terminalLevelClass,
} from "@/lib/log-format.js";
import { fetchLogTail } from "@/services/logs.js";

/** Keep the buffer bounded; a busy system outruns any reader. */
const MAX_ENTRIES = 1000;

const INTERVALS = [
  { ms: 1000, label: "1s" },
  { ms: 2000, label: "2s" },
  { ms: 5000, label: "5s" },
  { ms: 10000, label: "10s" },
];

function timeOf(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}

function TerminalLine({ entry }: { entry: LogEntry }) {
  const summary = requestSummary(entry);
  return (
    <div className="flex gap-2 whitespace-pre-wrap break-words px-3 py-0.5 hover:bg-white/5">
      <span className="shrink-0 text-slate-500">{timeOf(entry.ts)}</span>
      <span className={`w-12 shrink-0 font-semibold uppercase ${terminalLevelClass(entry.level)}`}>
        {entry.level}
      </span>
      <span className="shrink-0 text-violet-300">{entry.feature}</span>
      <span className="min-w-0 flex-1 text-slate-200">
        {entry.msg}
        {summary ? <span className="text-slate-400"> {formatRequestSummary(summary)}</span> : null}
      </span>
    </div>
  );
}

export function LogTail() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(true);
  const [intervalMs, setIntervalMs] = useState(2000);
  const [minLevel, setMinLevel] = useState<LogLevel | "">("");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const cursorRef = useRef<string | undefined>(undefined);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll when the viewer is already at the bottom, so scrolling up to
  // read is not yanked back down by the next poll.
  const stickToBottom = useRef(true);

  const poll = useCallback(async () => {
    try {
      const tail = await fetchLogTail(cursorRef.current);
      setError(null);
      if (tail.nextCursor) cursorRef.current = tail.nextCursor;
      if (tail.entries.length > 0) {
        // Oldest-first from the API; append at the bottom, keep the tail bounded.
        setEntries((current) => [...current, ...tail.entries].slice(-MAX_ENTRIES));
        setLastUpdate(Date.now());
      }
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      if (!document.hidden) await poll();
      if (!cancelled) timer = setTimeout(() => void loop(), intervalMs);
    };
    void loop();

    // Coming back to the tab should show fresh lines at once, not after a whole
    // interval — a hidden tab skipped its polls, so the gap can be large.
    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, intervalMs, poll]);

  // A slow heartbeat re-renders so the staleness hint below updates even when no
  // new lines are arriving (which is exactly when it matters).
  const [, setHeartbeat] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setHeartbeat((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, [running]);

  // No lines for a while, while running, usually means the log DATABASE sink is
  // off — the viewer reads the log database, so console-only logging shows nothing
  // here. Surface it rather than looking silently stuck.
  const stale = running && lastUpdate !== null && Date.now() - lastUpdate > 15000;

  // Stick to the bottom as new lines land, unless the viewer scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const threshold = minLevel ? (LEVEL_SEVERITY[minLevel] ?? 9) : 9;
  const shown = minLevel
    ? entries.filter((e) => (LEVEL_SEVERITY[e.level] ?? 9) <= threshold)
    : entries;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {running ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
              Live · every {intervalMs / 1000}s
            </span>
          ) : (
            "Paused"
          )}
          · {shown.length} lines
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Level
            <select
              value={minLevel}
              onChange={(event) => setMinLevel(event.target.value as LogLevel | "")}
              className="h-9 rounded-xl border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All</option>
              {LOG_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level} and up
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Refresh
            <select
              value={intervalMs}
              onChange={(event) => setIntervalMs(Number(event.target.value))}
              className="h-9 rounded-xl border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {INTERVALS.map((option) => (
                <option key={option.ms} value={option.ms}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <Button variant="secondary" size="sm" onClick={() => setRunning((v) => !v)}>
            {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {running ? "Pause" : "Resume"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEntries([]);
              stickToBottom.current = true;
            }}
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {stale ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          No new lines recently. The viewer reads the log database — if this stays quiet, check that
          the database sink is on under Settings → Logging.
        </p>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-[32rem] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 py-2 font-mono text-xs leading-relaxed text-slate-200"
      >
        {shown.length === 0 ? (
          <p className="px-3 py-2 text-slate-500">
            Waiting for log lines. Serving this page writes some, so they should appear shortly — if
            nothing arrives, enable the database log sink under Settings → Logging.
          </p>
        ) : (
          shown.map((entry) => <TerminalLine key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
