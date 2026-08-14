// Author: Brijesh Dave <https://github.com/brijeshdave>
// Log-database schema (separate database from the app DB). Single file with no
// cross-file imports because drizzle-kit loads it outside the TS path resolver.
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const appLogs = pgTable(
  "app_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    level: text("level").notNull(),
    /** Logical area, e.g. "auth", "http", "client". */
    feature: text("feature").notNull().default("api"),
    requestId: text("request_id"),
    userId: text("user_id"),
    companyId: uuid("company_id"),
    msg: text("msg").notNull(),
    context: jsonb("context"),
  },
  (t) => [
    index("app_logs_ts_idx").on(t.ts),
    index("app_logs_request_id_idx").on(t.requestId),
    index("app_logs_level_idx").on(t.level),
  ],
);
