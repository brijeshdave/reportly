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
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Uniform failure shape returned by every API endpoint. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: unknown;
  };
}
