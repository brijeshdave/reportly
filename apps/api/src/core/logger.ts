// Author: Brijesh Dave <https://github.com/brijeshdave>
// The application logger: structured JSON pino fanned out to every enabled sink.
// Redaction is applied once, here, so every sink inherits it. Levels and sink
// toggles come from settings and can change at runtime (no restart).
import pino, { type LoggerOptions, multistream } from "pino";

import { env } from "@/core/env.js";
import { reloadLoggingConfig } from "@/core/logging/config.js";
import { createFileStream } from "@/core/logging/file-sink.js";
import { floorLevel } from "@/core/logging/level-filter.js";
import { createConsoleStream, createLogDbStream } from "@/core/logging/sinks.js";

/**
 * Central redaction paths. Extended as features add sensitive fields; keeping it
 * here means every sink (console, file, log-DB) inherits it.
 */
export const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.password",
  "*.secret",
  "*.token",
  "*.clientSecret",
  "*.newPassword",
];

export const loggerOptions: LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: "[redacted]" },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
};

/**
 * Per-feature levels are applied inside each sink (see `logging/sinks.ts` and
 * `logging/file-sink.ts`), not by a filter wrapped around them.
 *
 * The wrapper was the obvious design and it is wrong: `pino.multistream` is not a
 * plain Writable. pino assigns `lastLevel` onto whatever destination it is given
 * immediately before calling `write`, and multistream reads that property to
 * decide which of its streams the line belongs to. Interpose a Writable and pino
 * sets `lastLevel` on the interposer, so multistream sees nothing and every line
 * is discarded — logging silently stops.
 *
 * pino itself runs at the *floor* (see level-filter.ts): the most verbose level
 * any feature asks for. That is what makes "email at debug while the rest stay at
 * info" possible at all, because pino drops a record below its own level before a
 * sink ever sees it. Each sink then removes what the floor let through but the
 * line's own feature did not ask for.
 */
export const logger = pino(
  loggerOptions,
  multistream([
    { stream: createConsoleStream() },
    { stream: createFileStream() },
    { stream: createLogDbStream() },
  ]),
);

/** Refresh sink toggles + levels from settings and apply them to the live logger. */
export async function reloadLogging(): Promise<void> {
  const config = await reloadLoggingConfig();
  // The floor, not the default: a feature turned up to debug has to get past pino
  // before the gate above can decide anything about it.
  logger.level = floorLevel(config.levels);
}
