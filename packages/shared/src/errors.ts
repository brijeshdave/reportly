// Author: Brijesh Dave <https://github.com/brijeshdave>
// Canonical error codes and the API error envelope — the single definition
// shared by the API (error handler) and web (typed error handling).

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  /** The caller's password is past its expiry; they may only change it. */
  PASSWORD_EXPIRED: "PASSWORD_EXPIRED",
  /** The submitted password matches one the user has used recently. */
  PASSWORD_REUSED: "PASSWORD_REUSED",
  /**
   * Two-factor is compulsory for this caller and they have not enrolled. Like
   * PASSWORD_EXPIRED it closes the app to everything but the way out of it — the
   * enrolment routes stay open, so this is a forced enrolment and never a lockout.
   */
  TWO_FACTOR_REQUIRED: "TWO_FACTOR_REQUIRED",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Per-field messages, keyed by the field's path in the request body.
 *
 * Dotted, and array indices are path segments: `title`, `targets.0.assetId`. That is
 * the shape a form indexes its own state by, which is the whole point — a refusal
 * the browser cannot attribute to a field can only be shown as a sentence above the
 * form, and a person reading "Request validation failed" has to guess which of
 * fourteen inputs it meant.
 */
export type FieldErrors = Record<string, string>;

/** Uniform failure shape returned by every API endpoint. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
    /**
     * Present on a refusal the server can attribute to particular fields. A client
     * shows these at the fields and falls back to `message` for the rest — a 403 or a
     * conflict has no field to belong to and must stay a sentence.
     */
    fields?: FieldErrors;
  };
}

/** The dotted key one issue path becomes. */
export function fieldPathOf(path: readonly (string | number | symbol)[]): string {
  return path.map((segment) => String(segment)).join(".");
}

/**
 * Collapse validation issues into one message per field.
 *
 * Takes the issue shape rather than a `ZodError` so this module stays free of its
 * own dependencies, and so the API can feed it fastify's already-flattened list as
 * easily as the browser feeds it a parse result. Both ends must agree on the keys or
 * the server's refusals land nowhere, which is why this is here and not written twice.
 *
 * **First issue per path wins.** A field with two complaints is still one field with
 * one message under it; showing the second would push the layout around for no gain,
 * and the first is the one a person fixes anyway.
 */
export function fieldErrorsFrom(
  issues: readonly { path: readonly (string | number | symbol)[]; message: string }[],
): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of issues) {
    // An issue with no path belongs to the object as a whole — a cross-field rule
    // like "the end time cannot be before the start time" that named no `path`. It
    // has no input to sit under, so it stays with the form-level message.
    if (issue.path.length === 0) continue;
    const key = fieldPathOf(issue.path);
    if (key in fields) continue;
    fields[key] = issue.message;
  }
  return fields;
}

/** True when the envelope carries at least one field to show a message against. */
export function hasFieldErrors(envelope: ErrorEnvelope): boolean {
  return Object.keys(envelope.error.fields ?? {}).length > 0;
}
