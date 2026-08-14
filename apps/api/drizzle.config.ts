// Author: Brijesh Dave <https://github.com/brijeshdave>
// drizzle-kit configuration for the app database. Reads DATABASE_URL directly
// (drizzle-kit runs outside the app's module resolver, so no `@/` alias here).
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/core/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://reportly:reportly@localhost:5432/reportly",
  },
});
