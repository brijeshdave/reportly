// Author: Brijesh Dave <https://github.com/brijeshdave>
// Describes a setting's Zod schema as a list of form fields. The admin screen is
// generated from this, so adding a setting to the registry is enough to make it
// editable — no hand-written form can drift from the schema that validates it.
import { z } from "zod";

export type SettingFieldKind = "number" | "boolean" | "enum" | "string" | "record" | "list";

export interface SettingField {
  /** Key within the setting's object schema. */
  key: string;
  kind: SettingFieldKind;
  /** Whole numbers only; the input steps by 1. */
  integer?: boolean;
  min?: number;
  max?: number;
  /** Allowed values for `kind: "enum"`, and for a record's values. */
  options?: readonly string[];
  /**
   * Suggested KEYS for `kind: "record"` — the values go in `options`.
   *
   * Suggestions, not a closed list: a record keyed by a plain string accepts
   * anything on purpose, and narrowing that in the form would take the freedom
   * away. But a bare text box tells an operator nothing about what belongs in it.
   */
  keyOptions?: readonly string[];
  /** "expiresInSeconds" -> "Expires in seconds". */
  label: string;
}

/** `expiresInSeconds` -> `Expires in seconds`. */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * zod 4 moved a schema's shape from `_def` to `_zod.def`, and renamed what is in
 * it: `typeName: "ZodNumber"` became `type: "number"`, and a number's checks went
 * from `{ kind: "min", value }` to `{ check: "greater_than", value }` with `int`
 * expressed as a `number_format` of `safeint`.
 *
 * Reaching into internals is what makes this file possible at all — a schema
 * cannot otherwise say what form control it wants — and it is also why a zod
 * major lands here first. The reads are collected in these two helpers so the
 * next one has a single place to touch.
 */
interface ZodInternals {
  type?: string;
  innerType?: z.ZodTypeAny;
  entries?: Record<string, string>;
  valueType?: z.ZodTypeAny;
  checks?: { _zod?: { def?: { check?: string; value?: number; format?: string } } }[];
}

function internals(schema: z.ZodTypeAny): ZodInternals {
  return ((schema as unknown as { _zod?: { def?: ZodInternals } })._zod?.def ?? {}) as ZodInternals;
}

/**
 * Strip `.default()`, `.optional()` and `.nullable()` to reach the underlying
 * type. `pageSize` is a coerced number behind a default, so without this it would
 * fall through to the "string" fallback and render as a text box.
 */
function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;

  for (;;) {
    const def = internals(current);
    if (def.innerType && ["default", "optional", "nullable", "prefault"].includes(def.type ?? "")) {
      current = def.innerType;
    } else {
      return current;
    }
  }
}

function numberConstraints(schema: z.ZodTypeAny): Pick<SettingField, "integer" | "min" | "max"> {
  const checks = (internals(schema).checks ?? []).map((check) => check._zod?.def ?? {});
  const valueOf = (name: string) => checks.find((check) => check.check === name)?.value;
  return {
    // Any integer format counts: `int()` is `safeint`, and `int32` and friends are
    // no less whole.
    integer: checks.some((check) => (check.format ?? "").includes("int")),
    min: valueOf("greater_than"),
    max: valueOf("less_than"),
  };
}

/** The fields of one setting, in declaration order. */
export function describeSettingSchema(schema: z.ZodTypeAny): SettingField[] {
  const root = unwrap(schema);
  if (!(root instanceof z.ZodObject)) return [];

  const shape = root.shape as Record<string, z.ZodTypeAny>;

  return Object.entries(shape).map(([key, raw]) => {
    const inner = unwrap(raw);
    const label = humanizeKey(key);

    switch (internals(inner).type) {
      case "number":
        return { key, label, kind: "number", ...numberConstraints(inner) };
      case "boolean":
        return { key, label, kind: "boolean" };
      case "enum":
        return { key, label, kind: "enum", options: Object.values(internals(inner).entries ?? {}) };
      case "array":
        // A list of free strings — MIME types, hostnames. Its own kind because the
        // fallback renders a text input, and a text input hands a *string* back to a
        // schema that demands an array: the save fails, and the form has no way to
        // say why. Anything that cannot be edited is not configuration.
        return { key, label, kind: "list" };
      case "record": {
        const valueType = internals(inner).valueType;
        const options = valueType
          ? Object.values(internals(unwrap(valueType)).entries ?? {})
          : undefined;
        return { key, label, kind: "record", options: options?.length ? options : undefined };
      }
      default:
        return { key, label, kind: "string" };
    }
  });
}
