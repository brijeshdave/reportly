// Author: Brijesh Dave <https://github.com/brijeshdave>
// Recognising Postgres constraint violations, whatever the driver wrapped them in.
//
// A unique-violation is the only way we learn that a name is taken without a
// read-then-write race, so a route that returns 409 depends on spotting it. The
// check used to read `err.code` off the thrown error, which worked until drizzle
// started wrapping driver errors in a `DrizzleQueryError` and moved the pg error
// to `err.cause` — the 409s silently became 500s and only the tests noticed.
//
// So walk the cause chain instead of reading one level. The next wrapper is free.

const UNIQUE_VIOLATION = "23505";

/** The `code` of the first error in the chain that carries one. */
function pgErrorCode(err: unknown): string | undefined {
  for (let current = err, depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** A row collided with a unique index (Postgres `23505`). */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === UNIQUE_VIOLATION;
}
