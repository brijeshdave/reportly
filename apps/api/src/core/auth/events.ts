// Author: Brijesh Dave <https://github.com/brijeshdave>
// Records authentication activity into audit_events. Called from the auth route
// handler so every auth action carries request context (ip, userAgent, requestId).
// Recording never blocks or fails the auth response.
import type { FastifyRequest } from "fastify";

import { db } from "@/core/db/index.js";
import { auditEvents } from "@/core/db/schema.js";
import { deviceFromRequest } from "@/core/device.js";

/** Map a better-auth sub-path + response status to an audit action (or null). */
export function authAction(subPath: string, status: number): string | null {
  const ok = status >= 200 && status < 300;
  switch (subPath) {
    case "/sign-in/email":
      return ok ? "auth.login.success" : "auth.login.failure";
    case "/sign-up/email":
      return ok ? "auth.register" : null;
    case "/sign-out":
      return ok ? "auth.logout" : null;
    case "/forget-password":
      return "auth.password.reset_requested";
    case "/reset-password":
      return ok ? "auth.password.reset" : null;
    case "/two-factor/verify-totp":
      return ok ? "auth.2fa.success" : "auth.2fa.failure";
    case "/two-factor/verify-backup-code":
      return ok ? "auth.2fa.recovery" : "auth.2fa.failure";
    case "/two-factor/enable":
      return ok ? "auth.2fa.enabled" : null;
    case "/two-factor/disable":
      return ok ? "auth.2fa.disabled" : null;
    default:
      return null;
  }
}

export async function recordAuthEvent(
  request: FastifyRequest,
  action: string,
  actorId?: string,
): Promise<void> {
  try {
    // The full device — parsed UA, client hints, the client fingerprint, geo when
    // configured — so a security event can be correlated and an unfamiliar device
    // or location spotted. Stored under details.device; the audit viewer reads it.
    const device = await deviceFromRequest(request);
    await db.insert(auditEvents).values({
      action,
      actorId: actorId ?? null,
      ip: request.ip,
      requestId: request.id,
      details: { device },
    });
  } catch (err) {
    request.log.warn({ err }, "Failed to record auth event");
  }
}
