// Author: Brijesh Dave <https://github.com/brijeshdave>
// Auth Fastify plugin: mounts the better-auth handler under /api/v1/auth/* and
// decorates the app with `authenticate`, `companyContext`, and `requirePermission`
// preHandlers. Routes compose these to gate access.
import {
  type AuthContext,
  ERROR_CODES,
  PASSWORD_POLICY,
  type Permission,
  can,
} from "@reportly/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

import { AUTH_BASE_PATH, getAuth } from "@/core/auth/auth.js";
import { buildAuthContext, hasCompanyAccess } from "@/core/auth/context.js";
import { isUserActive, mustChangePassword } from "@/core/auth/account-status.js";
import { authAction, recordAuthEvent } from "@/core/auth/events.js";
import { isPasswordExpired } from "@/core/auth/password-history.js";
import { resolveDebug } from "@/core/debug/service.js";
import { AppError } from "@/core/errors.js";
import { setRequestActor } from "@/core/request-context.js";
import { getSystemSetting } from "@/core/settings/service.js";

const COMPANY_HEADER = "x-company-id";

/**
 * The one authenticated route an expired caller may still reach, so the web app
 * can learn it must send them to change their password. Everything else is
 * refused: the password rules are meaningless if an expired password keeps
 * working. Changing it happens under /auth/*, which never passes through here.
 */
const ME_ROUTE = "/api/v1/me";

/**
 * Two ways a password stops being usable: it aged out, or an administrator chose
 * it and the person has not replaced it yet. Both close the app to everything but
 * /me, which is how the web app learns to send them to change it.
 */
async function enforcePasswordExpiry(request: FastifyRequest, userId: string): Promise<void> {
  if (await mustChangePassword(userId)) {
    request.passwordExpired = true;
    if (request.routeOptions.url === ME_ROUTE) return;
    throw new AppError(
      403,
      ERROR_CODES.PASSWORD_EXPIRED,
      "Choose your own password before continuing.",
    );
  }

  const policy = await getSystemSetting(PASSWORD_POLICY);
  // Expiry is off by default, and then this costs nothing.
  if (policy.expiryDays <= 0) return;

  if (!(await isPasswordExpired(userId, policy.expiryDays))) return;

  request.passwordExpired = true;
  if (request.routeOptions.url === ME_ROUTE) return;

  throw new AppError(
    403,
    ERROR_CODES.PASSWORD_EXPIRED,
    "Your password has expired. Change it to continue.",
  );
}

declare module "fastify" {
  interface FastifyRequest {
    authUserId?: string;
    /** The caller's own session token, so a session listing can mark "this device". */
    sessionToken?: string;
    ctx?: AuthContext;
    debugMode?: boolean;
    /** Set when the caller's password is past its expiry; only /me is reachable. */
    passwordExpired?: boolean;
  }
  interface FastifyInstance {
    authenticate: preHandlerHookHandler;
    companyContext: preHandlerHookHandler;
    requirePermission: (permission: Permission) => preHandlerHookHandler;
  }
}

/** Build a WHATWG Headers object from Fastify's incoming headers. */
function toHeaders(raw: FastifyRequest["headers"]): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.append(key, value);
  }
  return headers;
}

/** Build a WHATWG Request mirroring the Fastify request (for auth.handler). */
function toWebRequest(request: FastifyRequest): Request {
  const url = new URL(request.url, request.headers.origin ?? "http://localhost");
  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD" && request.body != null;
  return new Request(url.toString(), {
    method,
    headers: toHeaders(request.headers),
    body: hasBody ? JSON.stringify(request.body) : undefined,
  });
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  // Delegate all /api/v1/auth/* requests to better-auth.
  app.route({
    method: ["GET", "POST"],
    url: `${AUTH_BASE_PATH}/*`,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const response = await getAuth().handler(toWebRequest(request));
      const body = await response.text();

      // Record auth activity with full request context (never blocks the response).
      const subPath = request.url.slice(AUTH_BASE_PATH.length).split("?")[0] ?? "";
      const action = authAction(subPath, response.status);
      if (action) {
        let actorId: string | undefined;
        try {
          actorId = (JSON.parse(body) as { user?: { id?: string } })?.user?.id;
        } catch {
          // non-JSON body (e.g. redirect) — record without an actor
        }
        void recordAuthEvent(request, action, actorId);
      }

      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(body.length > 0 ? body : null);
    },
  });

  app.decorate("authenticate", async function (request: FastifyRequest) {
    const session = await getAuth().api.getSession({ headers: toHeaders(request.headers) });
    if (!session) {
      throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, "Authentication required");
    }
    // A session issued before the account was deactivated must stop working now,
    // not when it happens to expire.
    if (!(await isUserActive(session.user.id))) {
      throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, "This account has been deactivated");
    }

    request.authUserId = session.user.id;
    request.sessionToken = session.session.token;
    setRequestActor(session.user.id);
    // System debug applies to everyone; a user may additionally enable it for self.
    if (!request.debugMode) request.debugMode = await resolveDebug(session.user.id);

    await enforcePasswordExpiry(request, session.user.id);
  });

  app.decorate("companyContext", async function (request: FastifyRequest) {
    const userId = request.authUserId;
    if (!userId) {
      throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, "Authentication required");
    }
    const header = request.headers[COMPANY_HEADER];
    const companyId = (Array.isArray(header) ? header[0] : header) ?? null;
    if (companyId && !(await hasCompanyAccess(userId, companyId))) {
      throw new AppError(403, ERROR_CODES.FORBIDDEN, "No access to the requested company");
    }
    request.ctx = await buildAuthContext(userId, companyId, request.debugMode ?? false);
  });

  app.decorate("requirePermission", (permission: Permission): preHandlerHookHandler => {
    return async function (request: FastifyRequest) {
      const ctx = request.ctx;
      if (!ctx) {
        throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, "Authentication required");
      }
      if (!can(ctx, permission)) {
        throw new AppError(403, ERROR_CODES.FORBIDDEN, "Insufficient permissions");
      }
    };
  });
}
