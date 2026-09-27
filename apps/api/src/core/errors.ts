// Author: Brijesh Dave <https://github.com/brijeshdave>
// Uniform error handling: every failure leaves the API as the shared envelope.
// The envelope shape and error codes are defined once in @reportly/shared.
import {
  ERROR_CODES,
  fieldErrorsFrom,
  type ErrorCode,
  type ErrorEnvelope,
  type FieldErrors,
} from "@reportly/shared";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Application error carrying an HTTP status, stable code, and safe message. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;
  /**
   * The fields this refusal is about, so a form can show it where the person is
   * looking rather than as a sentence above everything.
   *
   * Worth setting on any rule a person can break by typing — a severity that must be
   * chosen, a date past the grace period. Leave it off for what has no field: a
   * permission, a conflict, a missing row.
   */
  readonly fields?: FieldErrors;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: unknown,
    fields?: FieldErrors,
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.fields = fields;
  }
}

function toEnvelope(
  code: ErrorEnvelope["error"]["code"],
  message: string,
  details?: unknown,
  fields?: FieldErrors,
): ErrorEnvelope {
  const error: ErrorEnvelope["error"] = { code, message };
  if (details !== undefined) error.details = details;
  if (fields && Object.keys(fields).length > 0) error.fields = fields;
  return { error };
}

/**
 * Fastify's validation list, as the field map a form can use.
 *
 * The zod type provider hands us `instancePath` in JSON-pointer form — `/title`,
 * `/targets/0/assetId` — so the segments are recovered and handed to the one shared
 * function that decides what a field is called. Doing the join here instead would be
 * a second answer to that question, and the browser validates against the very same
 * schemas.
 */
function fieldsFromValidation(validation: readonly unknown[]): FieldErrors {
  const issues: { path: string[]; message: string }[] = [];
  for (const entry of validation) {
    if (typeof entry !== "object" || entry === null) continue;
    const { instancePath, message } = entry as { instancePath?: unknown; message?: unknown };
    if (typeof instancePath !== "string" || typeof message !== "string") continue;
    issues.push({ path: instancePath.split("/").filter((s) => s !== ""), message });
  }
  return fieldErrorsFrom(issues);
}

/** Wire the global error and not-found handlers onto a Fastify instance. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    reply
      .status(404)
      .send(toEnvelope(ERROR_CODES.NOT_FOUND, `Route ${req.method} ${req.url} not found`));
  });

  app.setErrorHandler(
    (error: FastifyError | AppError, req: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof AppError) {
        reply
          .status(error.statusCode)
          .send(toEnvelope(error.code, error.message, error.details, error.fields));
        return;
      }

      // Fastify validation errors carry a `validation` array — surface as 400.
      if ("validation" in error && error.validation) {
        // Only the body's fields. A form has an input for every key in its own
        // payload and none at all for a bad path parameter or query string, so
        // attributing those to a field would point at something that is not on the
        // screen; they stay the sentence they already were.
        const fields =
          error.validationContext === "body" ? fieldsFromValidation(error.validation) : undefined;
        reply
          .status(400)
          .send(
            toEnvelope(
              ERROR_CODES.VALIDATION_ERROR,
              "Request validation failed",
              error.validation,
              fields,
            ),
          );
        return;
      }

      const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
      if (statusCode >= 500) {
        req.log.error({ err: error }, "Unhandled error");
        reply
          .status(statusCode)
          .send(toEnvelope(ERROR_CODES.INTERNAL_ERROR, "An unexpected error occurred"));
        return;
      }

      reply
        .status(statusCode)
        .send(toEnvelope(error.code ?? ERROR_CODES.INTERNAL_ERROR, error.message));
    },
  );
}
