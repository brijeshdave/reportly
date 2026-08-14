// Author: Brijesh Dave <https://github.com/brijeshdave>
// The environment reference is generated from the schema. These tests are the
// drift guard: adding a variable without describing it, or without regenerating
// the doc, fails here rather than shipping a reference that lies.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { envVarDocs, renderEnvReference } from "@/lib/env-docs.js";

const DOC_PATH = resolve(process.cwd(), "../../docs/reference/environment.md");

describe("envVarDocs", () => {
  it("describes every variable", () => {
    const undescribed = envVarDocs()
      .filter((entry) => entry.description.trim() === "")
      .map((entry) => entry.name);

    expect(undescribed).toEqual([]);
  });

  it("treats a variable with a default as optional", () => {
    const port = envVarDocs().find((entry) => entry.name === "PORT");
    expect(port).toMatchObject({ required: false, defaultValue: "3000" });
  });

  it("treats an optional variable as not required and without a default", () => {
    const smtpUser = envVarDocs().find((entry) => entry.name === "SMTP_USER");
    expect(smtpUser).toMatchObject({ required: false, defaultValue: null });
  });

  it("covers the variables an operator must get right", () => {
    const names = envVarDocs().map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "DATABASE_URL",
        "LOG_DATABASE_URL",
        "REDIS_URL",
        "BETTER_AUTH_SECRET",
        "WEB_URL",
      ]),
    );
  });
});

describe("the committed reference", () => {
  it("matches what the schema generates", async () => {
    const committed = await readFile(DOC_PATH, "utf8");
    // Run `pnpm docs:env` after changing apps/api/src/core/env.ts.
    expect(committed).toBe(renderEnvReference());
  });
});
