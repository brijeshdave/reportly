// Author: Brijesh Dave <https://github.com/brijeshdave>
// Seeded rows tests need by id rather than by guess.
//
// Submitting a breakdown without a severity is refused — the severity is what sets
// the points ceiling, so one filed without it would be scored against a fallback
// nobody chose. Every test that files a submitted issue therefore needs a real
// severity, and reaching for one through the API in each file meant eleven copies
// of the same three lines.
import { asc } from "drizzle-orm";

import { db } from "@/core/db/index.js";
import { severities } from "@/core/db/schema.js";

/** The lowest seeded severity — any real one will do; the ladder starts here. */
export async function anySeverityId(): Promise<string> {
  const [row] = await db
    .select({ id: severities.id })
    .from(severities)
    .orderBy(asc(severities.orderIndex))
    .limit(1);
  if (!row) throw new Error("No severities seeded — the test database is not set up");
  return row.id;
}
