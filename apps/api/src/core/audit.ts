// Author: Brijesh Dave <https://github.com/brijeshdave>
// Audit trail helper. Records critical actions (create/update/delete, access
// changes) to audit_events with actor, company, ip, requestId, and before/after
// snapshots. Never throws into the caller — auditing must not break the action.
import type { AuthContext } from "@reportly/shared";
import type { FastifyRequest } from "fastify";

import { db } from "@/core/db/index.js";
import { auditEvents } from "@/core/db/schema.js";
import { deviceFromRequest } from "@/core/device.js";

export interface AuditInput {
  action: string;
  companyId?: string | null;
  before?: unknown;
  after?: unknown;
  details?: unknown;
}

export async function recordAudit(
  request: FastifyRequest,
  ctx: Pick<AuthContext, "userId" | "companyId">,
  input: AuditInput,
): Promise<void> {
  try {
    // The device rides in details.device on every event, so who-did-what always
    // carries from-where. An explicit details object is preserved beside it.
    const device = await deviceFromRequest(request);
    const base = input.details && typeof input.details === "object" ? input.details : {};
    await db.insert(auditEvents).values({
      action: input.action,
      actorId: ctx.userId,
      companyId: input.companyId ?? ctx.companyId,
      ip: request.ip,
      requestId: request.id,
      details: { ...base, device },
      before: input.before ?? null,
      after: input.after ?? null,
    });
  } catch (err) {
    request.log.warn({ err, action: input.action }, "Failed to record audit event");
  }
}
