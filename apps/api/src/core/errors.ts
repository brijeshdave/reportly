// Author: Brijesh Dave <https://github.com/brijeshdave>
// Uniform error handling: every failure leaves the API as the shared envelope.
// The envelope shape and error codes are defined once in @reportly/shared.
import { ERROR_CODES, type ErrorCode, type ErrorEnvelope } from "@reportly/shared";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/** Application error carrying an HTTP status, stable code, and safe message. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function toEnvelope(
  code: ErrorEnvelope["error"]["code"],
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
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
        reply.status(error.statusCode).send(toEnvelope(error.code, error.message, error.details));
        return;
      }

      // Fastify validation errors carry a `validation` array — surface as 400.
      if ("validation" in error && error.validation) {
        reply
          .status(400)
          .send(
            toEnvelope(ERROR_CODES.VALIDATION_ERROR, "Request validation failed", error.validation),
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
