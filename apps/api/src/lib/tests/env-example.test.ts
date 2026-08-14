// Author: Brijesh Dave <https://github.com/brijeshdave>
// Every environment variable the app reads appears in `.env.example`, and every
// image the docs point at exists.
//
// Both are "the code is right and the thing around it is wrong" faults, which is
// the kind this project keeps producing and the kind no amount of typechecking
// catches.
//
// The env one is not hypothetical. `QUEUE_ADMIN` was added to the schema and
// documented in the generated reference, and the queue management screens were
// simply invisible — because the variable never reached `.env.example`, so nobody
// copying that template into their own `.env` ever learned the feature existed.
// It took a live debugging session to find, and the answer was one missing line.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { envVarDocs } from "@/lib/env-docs.js";

const repoRoot = resolve(process.cwd(), "../..");

describe(".env.example", () => {
  const example = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");

  it("mentions every variable the app reads", () => {
    // Commented out is fine — `# QUEUE_ADMIN=off` still tells a reader the knob
    // exists and what its default is, which is the whole job of the file. What
    // fails here is absence.
    const missing = envVarDocs()
      .map((entry) => entry.name)
      .filter((name) => !new RegExp(`^#?\\s*${name}=`, "m").test(example));

    expect(
      missing,
      `These variables are read by the app but appear nowhere in .env.example, so ` +
        `anybody setting up from the template will never know they exist:\n  ` +
        `${missing.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("the documentation's images", () => {
  function markdownFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry);
      if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
      else if (entry.endsWith(".md")) out.push(full);
    }
    return out;
  }

  it("all exist", () => {
    // A doc referencing a screenshot that was never captured renders as a broken
    // image — visible to every reader and invisible to every test until now.
    const docsDir = resolve(repoRoot, "docs");
    const screenshots = resolve(docsDir, "screenshots");

    const referenced = new Set<string>();
    for (const file of markdownFiles(docsDir)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/screenshots\/([\w.-]+\.(?:png|jpg|jpeg|webp))/g)) {
        referenced.add(match[1]!);
      }
    }

    const missing = [...referenced].filter((name) => !existsSync(resolve(screenshots, name)));

    expect(
      missing,
      `The docs point at these images and they are not in docs/screenshots — every ` +
        `page that names one shows a broken image:\n  ${missing.join("\n  ")}\n\n` +
        `Regenerate with: pnpm --filter @reportly/e2e exec tsx screenshots.ts`,
    ).toEqual([]);
  });
});
