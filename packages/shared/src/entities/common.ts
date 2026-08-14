// Author: Brijesh Dave <https://github.com/brijeshdave>
// Reusable field schemas shared across entity contracts (ids, names, timestamps,
// status) so every entity validates these the same way.
import { z } from "zod";

/**
 * An id, as this app issues them.
 *
 * `z.guid()`, not `z.uuid()`. zod 4 split what zod 3 called `.uuid()` into two:
 * `uuid()` now demands an RFC-compliant version and variant nibble, while
 * `guid()` keeps the old, permissive 8-4-4-4-12 hex check. The seed issues
 * readable fixed ids — `11111111-1111-1111-1111-111111111111` and friends — which
 * are perfectly good identifiers and not valid RFC UUIDs, so the strict form
 * rejected the demo company on every response that carried it.
 */
export const uuidSchema = z.guid();

/** Human-facing display name: trimmed, non-empty, bounded. */
export const nameSchema = z.string().trim().min(1).max(120);

export const entityStatusSchema = z.enum(["active", "inactive"]);
export type EntityStatus = z.infer<typeof entityStatusSchema>;

/** ISO-8601 UTC timestamps present on every persisted entity. */
export const timestampsSchema = z.object({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/**
 * A PATCH schema: every field optional, and every default removed.
 *
 * `.partial()` alone is not enough under zod 4. It makes a field optional but
 * leaves its `.default()` attached, so parsing `{ name }` returns every other
 * defaulted field as well — and an update that writes what it parsed then
 * silently resets them. Under zod 3 `.partial()` dropped the default, so the
 * whole codebase's update schemas changed meaning on the bump without a single
 * type error to show for it.
 *
 * What that would have cost, found by parsing `{}` through each of them: renaming
 * a severity silently reset every other field on it, and saving any change to a
 * role wiped its permissions to none.
 *
 * Absent has to keep meaning "leave it alone". That is the whole contract of a
 * PATCH, and it is not something to re-derive at each of a dozen call sites.
 */
export function patchSchemaOf<Shape extends z.ZodRawShape>(
  base: z.ZodObject<Shape>,
): z.ZodObject<{ [K in keyof Shape]: z.ZodOptional<Shape[K]> }> {
  const shape = base.shape as unknown as Record<string, z.ZodTypeAny>;
  const next: Record<string, z.ZodTypeAny> = {};

  for (const [key, field] of Object.entries(shape)) {
    next[key] = stripDefault(field).optional();
  }

  return z.object(next) as z.ZodObject<{ [K in keyof Shape]: z.ZodOptional<Shape[K]> }>;
}

/** Peel `.default()` / `.prefault()` off a field, leaving what it wraps. */
function stripDefault(field: z.ZodTypeAny): z.ZodTypeAny {
  let current = field;
  for (;;) {
    const def = (
      current as unknown as { _zod?: { def?: { type?: string; innerType?: z.ZodTypeAny } } }
    )._zod?.def;
    if (def?.innerType && (def.type === "default" || def.type === "prefault")) {
      current = def.innerType;
    } else {
      return current;
    }
  }
}
