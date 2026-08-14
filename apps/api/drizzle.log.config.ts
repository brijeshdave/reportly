// Author: Brijesh Dave <https://github.com/brijeshdave>
// drizzle-kit configuration for the separate LOG database. Reads LOG_DATABASE_URL
// directly (drizzle-kit runs outside the app's module resolver, so no `@/` alias).
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/core/logdb/schema.ts",
  out: "./drizzle-log",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.LOG_DATABASE_URL ?? "postgres://reportly:reportly@localhost:5432/reportly_logs",
  },
});
