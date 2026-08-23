// Author: Brijesh Dave <https://github.com/brijeshdave>
// Auth Fastify plugin: mounts the better-auth handler under /api/v1/auth/* and
// decorates the app with `authenticate`, `companyContext`, and `requirePermission`
// preHandlers. Routes compose these to gate access.
import {
  type AuthContext,
  ERROR_CODES,
  PASSWORD_POLICY,
  PASSWORD_RESET,
  type Permission,
  can,
} from "@reportly/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

import { AUTH_BASE_PATH, getAuth } from "@/core/auth/auth.js";
import { buildAuthContext, hasCompanyAccess } from "@/core/auth/context.js";
import { isUserActive, mustChangePassword } from "@/core/auth/account-status.js";
import {
  THROTTLED_PATHS,
  assertNotLockedOut,
  clearOnSuccess,
  recordFailure,
} from "@/core/auth/login-throttle.js";
import { isSuperadmin } from "@/core/auth/context.js";
import { twoFactorRequirement, type TwoFactorRequirement } from "@/core/auth/two-factor-policy.js";
import { authAction, recordAuthEvent } from "@/core/auth/events.js";
import { env } from "@/core/env.js";
import { isPasswordExpired } from "@/core/auth/password-history.js";
import { resolveDebug } from "@/core/debug/service.js";
import { isCompanyActive } from "@/features/companies/active.js";
import { announceLockout, noteSignIn } from "@/features/users/service.js";
import { isCompanyOwnedPath } from "@/features/companies/scoped-routes.js";
import { AppError } from "@/core/errors.js";
import { setRequestActor } from "@/core/request-context.js";
import { getSystemSetting } from "@/core/settings/service.js";

const COMPANY_HEADER = "x-company-id";

// Spelled out rather than imported from `core/app.ts`: that module registers this
// plugin, and importing back the other way makes a cycle. It is derived from the
// auth base path, so the two cannot drift apart unnoticed.
const VERSION_PREFIX = AUTH_BASE_PATH.replace(/\/auth$/, "");

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

/**
 * Two-factor, when somebody has made it compulsory and this person has not enrolled.
 *
 * The same shape as password expiry, and for the same reason: everything closes
 * except the way out of it. `/me` stays open so the web app can learn what is wrong,
 * and the enrolment endpoints live under /auth/* which never passes through here —
 * so a blocked person can always finish enrolling. **This is a forced enrolment, not
 * a lockout**, and that distinction is the whole design.
 *
 * Only past the grace period. Inside it the request goes through and `/me` reports
 * the deadline, which is what the banner counts down.
 */
async function enforceTwoFactor(request: FastifyRequest, userId: string): Promise<void> {
  const requirement = await twoFactorRequirement({
    userId,
    companyId: null,
    isSuperadmin: await isSuperadmin(userId),
  });
  request.twoFactor = requirement;
  if (!requirement.overdue) return;
  if (request.routeOptions.url === ME_ROUTE) return;

  throw new AppError(
    403,
    ERROR_CODES.TWO_FACTOR_REQUIRED,
    "Two-factor authentication is required on this account. Set it up to continue.",
  );
}

/** Anything that could add to, change or remove data. */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The public "I forgot my password" doors, by both names better-auth answers on.
 *
 * The web app calls `/request-password-reset`; `/forget-password` is the older
 * spelling and is just as reachable, so a rule that named only one would be a rule
 * anybody could walk around.
 */
const SELF_SERVICE_RESET_PATHS = new Set(["/request-password-reset", "/forget-password"]);

/** Whether people may reset their own password. Fails open, like every other gate here. */
async function selfServiceResetAllowed(): Promise<boolean> {
  try {
    return (await getSystemSetting(PASSWORD_RESET)).allowSelfService;
  } catch {
    return true;
  }
}

/**
 * A deactivated company is closed for business, not merely labelled.
 *
 * Every company-scoped write takes its company from `ctx.companyId`, which is set
 * here — so this one place closes the door on all of them at once, rather than each
 * feature remembering to ask. Reads are untouched: the point of deactivating a
 * company is to stop it accruing new work, not to hide the years of work already in
 * it, which people still need to read, export and report on.
 *
 * Not exempt for superadmins. An exemption would make the flag mean "inactive
 * unless somebody important is typing", which is not a state anybody can reason
 * about. Reactivating stays possible because `/companies` is not in the list of
 * company-owned paths — the web app sends the company header on every request, so
 * without that distinction a deactivated company could never be turned back on.
 *
 * 409 rather than 403 — permission is not the problem. Whoever is doing this may
 * well be allowed to; the company is simply shut.
 */
async function assertCompanyOpen(request: FastifyRequest, companyId: string): Promise<void> {
  if (!WRITE_METHODS.has(request.method)) return;

  // Only the company's own work, not everything a request happens to carry the
  // header on — see `companies/scoped-routes.ts` for why that distinction is the
  // difference between a guard and a locked-in administrator.
  const url = request.routeOptions.url ?? request.url;
  if (!isCompanyOwnedPath(url.slice(VERSION_PREFIX.length).split("?")[0] ?? "")) return;

  if (await isCompanyActive(companyId)) return;

  throw new AppError(
    409,
    ERROR_CODES.CONFLICT,
    "This company is deactivated, so nothing new can be added to it or changed in it. Reactivate it first.",
  );
}

declare module "fastify" {
  interface FastifyRequest {
    authUserId?: string;
    /** The caller's own session token, so a session listing can mark "this device". */
    sessionToken?: string;
    /** Resolved two-factor requirement, for /me to report and the gate to enforce. */
    twoFactor?: TwoFactorRequirement;
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

/**
 * The username or email an attempt is for, so the throttle counts per account.
 *
 * Read from the body because that is where better-auth's sign-in payloads carry it.
 * Unrecognised shapes fall back to null, which buckets by address alone — the old
 * behaviour, and the right floor for an endpoint that names nobody.
 */
function identityFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const shape = body as { email?: unknown; username?: unknown };
  if (typeof shape.username === "string" && shape.username.trim() !== "") return shape.username;
  if (typeof shape.email === "string" && shape.email.trim() !== "") return shape.email;
  return null;
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
  //
  // **Rate limiting is enforced, inside the handler rather than around it.**
  // Static analysis flags this route as unthrottled — reasonably, since nothing
  // visible here throttles it — but `createAuth` configures better-auth's own
  // Redis-backed limiter: 100 requests a minute globally, and stricter custom
  // rules on the doors worth guarding (sign-in by email and by username at the
  // configured policy, sign-up 5/min, forgot-password 3/min, TOTP verify 5/min).
  // It is disabled only under NODE_ENV=test, so integration suites do not trip
  // each other's limits.
  //
  // Adding a second limiter here would double-count every request. If you are
  // changing the limits, they live in `core/auth/auth.ts`, and the sign-in pair
  // is administrator-configurable through the settings framework.
  app.route({
    method: ["GET", "POST"],
    url: `${AUTH_BASE_PATH}/*`,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      // Throttle the credential doors ourselves, keyed by username *and* address —
      // see core/auth/login-throttle.ts for why better-auth's IP-only bucket was
      // refusing correct passwords for everybody behind one office NAT.
      const path = request.url.slice(AUTH_BASE_PATH.length).split("?")[0] ?? "";
      const door = THROTTLED_PATHS[path];
      const identity = identityFrom(request.body);
      const throttled = Boolean(door) && env.NODE_ENV !== "test";
      if (throttled) {
        try {
          await assertNotLockedOut(identity, request.ip, door!);
        } catch (error) {
          // Recorded before it is refused, so "why could I not sign in?" has an
          // answer in the audit trail rather than only in somebody's memory.
          void recordAuthEvent(request, "auth.rate-limited");
          throw error;
        }
      }

      // Self-service password reset can be switched off entirely. Refused here,
      // before better-auth sees it, because the alternative — letting the flow run
      // and dropping the email — leaves somebody watching an inbox for a message
      // that was never sent.
      //
      // The two public spellings only. An invitation is issued through the very
      // same mechanism (`sendSetPasswordLink` calls requestPasswordReset), and
      // stopping that would silently prevent anybody new from joining.
      if (SELF_SERVICE_RESET_PATHS.has(path) && !(await selfServiceResetAllowed())) {
        void recordAuthEvent(request, "auth.password.reset_refused");
        throw new AppError(
          403,
          ERROR_CODES.FORBIDDEN,
          "Password reset is handled by your administrator. Ask them to set a new password for you.",
        );
      }

      const response = await getAuth().handler(toWebRequest(request));
      const body = await response.text();

      if (throttled) {
        if (response.status >= 400) {
          // Only a refusal counts. A lockout defends against guessing, and a correct
          // password is not a guess — counting every attempt locked people out while
          // they were typing the right one.
          //
          // The attempt that closes the door is also the one worth telling somebody
          // about. Only that one: the failures after it are the same fact repeated,
          // and an account being hammered would empty itself into every operator's
          // bell.
          void recordFailure(identity, request.ip, door!).then((state) =>
            state.locked && state.attempts === state.max
              ? announceLockout(identity, request.ip)
              : undefined,
          );
        } else {
          // Proving who you are ends the count, so yesterday's typos do not follow
          // somebody into today.
          void clearOnSuccess(identity, request.ip);
        }
      }

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

        // "Last seen" is written from the one place that already knows a sign-in
        // succeeded and who it was. Fire-and-forget: a bookkeeping column must
        // never be able to fail somebody's sign-in.
        // Registering counts too: it signs the person in, and leaving it out
        // would show somebody who joined this morning as never seen.
        if (
          actorId &&
          (action === "auth.login.success" ||
            action === "auth.2fa.success" ||
            action === "auth.register")
        ) {
          void noteSignIn(actorId);
        }
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
    await enforceTwoFactor(request, session.user.id);
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
    if (companyId) await assertCompanyOpen(request, companyId);
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
