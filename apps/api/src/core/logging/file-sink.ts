// Author: Brijesh Dave <https://github.com/brijeshdave>
// Rotating file sink: one file per UTC day (app-YYYY-MM-DD.log) in LOG_DIR. The
// stream reopens when the day changes; retention removes old files. No extra
// dependency — rotation is just "which file is today's".
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";

import { env } from "@/core/env.js";
import { getLoggingConfig } from "@/core/logging/config.js";
import { passesFeatureLevel } from "@/core/logging/level-filter.js";

let current: { day: string; stream: WriteStream } | null = null;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function streamForToday(): WriteStream {
  const day = today();
  if (!current || current.day !== day) {
    current?.stream.end();
    mkdirSync(env.LOG_DIR, { recursive: true });
    current = {
      day,
      stream: createWriteStream(join(env.LOG_DIR, `app-${day}.log`), { flags: "a" }),
    };
  }
  return current.stream;
}

export function createFileStream(): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      callback(); // never block logging on disk I/O
      const { sinks, levels } = getLoggingConfig();
      if (!sinks.file) return;
      if (!passesFeatureLevel(chunk.toString(), levels)) return;
      try {
        streamForToday().write(chunk);
      } catch {
        // A failing sink must never surface as an application error.
      }
    },
  });
}

export function closeLogFile(): void {
  current?.stream.end();
  current = null;
}
