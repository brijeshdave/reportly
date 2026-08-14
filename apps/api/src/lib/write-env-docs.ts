// Author: Brijesh Dave <https://github.com/brijeshdave>
// Writes the generated environment reference into /docs. Run via `pnpm docs:env`.
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderEnvReference } from "@/lib/env-docs.js";

const target = resolve(process.cwd(), "../../docs/reference/environment.md");
await writeFile(target, renderEnvReference(), "utf8");
console.log(`Wrote ${target}`);
