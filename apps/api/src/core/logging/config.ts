// Author: Brijesh Dave <https://github.com/brijeshdave>
// In-memory snapshot of the logging settings. Log sinks are consulted on every
// line, so they must read a synchronous snapshot rather than hit Redis/the DB.
// Refreshed at startup and whenever a `logging.*` setting is written.
import {
  LOG_BUFFER,
  LOG_LEVEL_SETTINGS,
  LOG_SINKS,
  defaultFor,
  type logBufferSchema,
  type logLevelsSchema,
  type logSinksSchema,
} from "@reportly/shared";
import type { z } from "zod";

import { getSystemSetting } from "@/core/settings/service.js";

export interface LoggingConfig {
  sinks: z.infer<typeof logSinksSchema>;
  levels: z.infer<typeof logLevelsSchema>;
  buffer: z.infer<typeof logBufferSchema>;
}

let snapshot: LoggingConfig = {
  sinks: defaultFor(LOG_SINKS),
  levels: defaultFor(LOG_LEVEL_SETTINGS),
  buffer: defaultFor(LOG_BUFFER),
};

export function getLoggingConfig(): LoggingConfig {
  return snapshot;
}

export async function reloadLoggingConfig(): Promise<LoggingConfig> {
  const [sinks, levels, buffer] = await Promise.all([
    getSystemSetting(LOG_SINKS),
    getSystemSetting(LOG_LEVEL_SETTINGS),
    getSystemSetting(LOG_BUFFER),
  ]);
  snapshot = { sinks, levels, buffer };
  return snapshot;
}
