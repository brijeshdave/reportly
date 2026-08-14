// Author: Brijesh Dave <https://github.com/brijeshdave>
// Request correlation: honour an inbound x-request-id or mint one, and echo it
// back on the response so a single id follows a user action end-to-end.
import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

export const REQUEST_ID_HEADER = "x-request-id";

/** Reuse a well-formed inbound id, otherwise generate a fresh UUID. */
export function generateRequestId(req: FastifyRequest["raw"]): string {
  const inbound = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(inbound) ? inbound[0] : inbound;
  if (typeof value === "string" && value.length > 0 && value.length <= 200) {
    return value;
  }
  return randomUUID();
}

/** Echo the resolved request id back to the caller on every response. */
export function registerRequestId(app: FastifyInstance): void {
  app.addHook("onSend", async (req, reply) => {
    reply.header(REQUEST_ID_HEADER, req.id);
  });
}
