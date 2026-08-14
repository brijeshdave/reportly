// Author: Brijesh Dave <https://github.com/brijeshdave>
// Log sinks. Each is a Writable that pino feeds serialized (already redacted) JSON
// lines. Sinks consult the settings snapshot on every line, so toggling a sink in
// the UI takes effect immediately. Logging must never throw or block the request:
// every sink acknowledges the write first and swallows its own failures.
import { Writable } from "node:stream";

import { pushLogLine } from "@/core/logging/buffer.js";
import { getLoggingConfig } from "@/core/logging/config.js";
import { passesFeatureLevel } from "@/core/logging/level-filter.js";
import { parseLogLine } from "@/core/logging/map.js";
import { logDb } from "@/core/logdb/index.js";
import { appLogs } from "@/core/logdb/schema.js";

/** Console sink — stdout, gated by the `logging.sinks.console` setting. */
export function createConsoleStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const { sinks, levels } = getLoggingConfig();
      if (sinks.console && passesFeatureLevel(chunk.toString(), levels)) {
        process.stdout.write(chunk);
      }
      callback();
    },
  });
}

/**
 * Log-database sink — gated by `logging.sinks.database`. When the Redis buffer is
 * enabled the line is queued instead of inserted inline; otherwise it is written
 * fire-and-forget so a slow database never delays a request.
 */
export function createLogDbStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      callback(); // acknowledge immediately: never block logging on the database
      const { sinks, buffer, levels } = getLoggingConfig();
      if (!sinks.database) return;

      const line = chunk.toString();
      if (!passesFeatureLevel(line, levels)) return;
      if (buffer.enabled) {
        void pushLogLine(line);
        return;
      }

      const row = parseLogLine(line);
      if (!row) return;
      void logDb
        .insert(appLogs)
        .values(row)
        .catch(() => {
          // A failing log sink must never surface as an application error.
        });
    },
  });
}
