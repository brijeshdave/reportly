// Author: Brijesh Dave <https://github.com/brijeshdave>
// better-auth instance: email/password + TOTP two-factor + generic OAuth (SSO).
// SSO providers are loaded from the settings store and can be reloaded without a
// redeploy. The instance lives behind getAuth() so a reload swaps it; callers
// always read the current instance. Ids are UUIDs (shared uuid contract).
import { randomUUID } from "node:crypto";

import {
  AUTH_RATE_LIMIT,
  PASSWORD_POLICY,
  SESSION_SETTINGS,
  type SsoProviderId,
  type authRateLimitSchema,
  defaultFor,
  type passwordPolicySchema,
  type sessionSettingsSchema,
} from "@reportly/shared";
import { betterAuth } from "better-auth";
import type { z } from "zod";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { openAPI } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username as usernamePlugin } from "better-auth/plugins/username";

import { clearMustChangePassword, isUserActive } from "@/core/auth/account-status.js";
import { recordCurrentPassword } from "@/core/auth/password-history.js";
import { passwordPolicyHook } from "@/core/auth/password-policy.js";
import { uniqueUsername } from "@/core/auth/username.js";
import { db } from "@/core/db/index.js";
import { accounts, sessions, twoFactors, users, verifications } from "@/core/db/schema.js";
import { corsOrigins, env, trustsForwardedIp, useSecureCookies } from "@/core/env.js";
import { inviteEmail, resetPasswordEmail } from "@/core/mail/templates.js";
import { enqueueEmail } from "@/core/queue/email.js";
import { enabledProviders } from "@/features/sso/service.js";
import { redis } from "@/core/redis.js";
import { getSystemSetting } from "@/core/settings/service.js";

export const AUTH_BASE_PATH = "/api/v1/auth";

/** better-auth stores the email/password credential under this provider id. */
const CREDENTIAL_PROVIDER = "credential";

type OAuthConfigs = NonNullable<Parameters<typeof genericOAuth>[0]>["config"];

// Providers with a well-known OIDC discovery document; the rest derive theirs
// from the admin-supplied issuer.
const WELL_KNOWN_DISCOVERY: Partial<Record<SsoProviderId, string>> = {
  google: "https://accounts.google.com/.well-known/openid-configuration",
  microsoft: "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
};

function discoveryUrl(id: SsoProviderId, issuer: string): string {
  return (
    WELL_KNOWN_DISCOVERY[id] ?? `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`
  );
}

async function buildOAuthConfigs(): Promise<OAuthConfigs> {
  const providers = await enabledProviders();
  return providers.map(({ id, config }) => ({
    providerId: id,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    discoveryUrl: discoveryUrl(id, config.issuer),
    scopes: ["openid", "email", "profile"],
    pkce: true,
  }));
}

/** Auth behaviour that admins configure through the settings framework. */
export interface AuthSettings {
  passwordPolicy: z.infer<typeof passwordPolicySchema>;
  session: z.infer<typeof sessionSettingsSchema>;
  rateLimit: z.infer<typeof authRateLimitSchema>;
}

const defaultAuthSettings = (): AuthSettings => ({
  passwordPolicy: defaultFor(PASSWORD_POLICY),
  session: defaultFor(SESSION_SETTINGS),
  rateLimit: defaultFor(AUTH_RATE_LIMIT),
});

function createAuth(oauthConfigs: OAuthConfigs, settings: AuthSettings) {
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: corsOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications, twoFactors },
    }),
    // Redis as cache/secondary storage; sessions still persist in the DB so they
    // remain listable/revocable (Step 5).
    secondaryStorage: {
      get: (key) => redis.get(key),
      set: async (key, value, ttl) => {
        if (ttl) await redis.set(key, value, "EX", ttl);
        else await redis.set(key, value);
      },
      delete: async (key) => {
        await redis.del(key);
      },
    },
    session: {
      storeSessionInDatabase: true,
      expiresIn: settings.session.expiresInSeconds,
      updateAge: settings.session.updateAgeSeconds,
    },
    // Redis-backed rate limiting; stricter limits on credential endpoints.
    // Disabled under tests so integration suites don't trip cross-test limits.
    rateLimit: {
      enabled: env.NODE_ENV !== "test",
      storage: "secondary-storage",
      window: 60,
      max: 100,
      // The credential doors are counted by `core/auth/login-throttle.ts` instead,
      // which keys on the account as well as the address. Two limiters on one path
      // would double-count, and this one cannot see a username — the whole problem
      // it was causing.
      //
      // `false` **switches this limiter off** for those paths, and saying so is not
      // optional: simply leaving them out does not make them unlimited, it drops
      // them onto better-auth's own built-in rule of **3 requests per 10 seconds
      // per IP** for anything beginning `/sign-in` — stricter than the rule it
      // replaced, and IP-keyed, which is the fault we are fixing. Omitting these
      // entries broke three sign-ins in a row in the e2e suite, and would have
      // locked out an office faster than before.
      customRules: {
        "/sign-in/email": false,
        "/sign-in/username": false,
        "/forget-password": false,
        "/request-password-reset": false,
        "/two-factor/verify-totp": false,
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    // Link SSO logins to an existing account when the verified email matches.
    account: {
      accountLinking: { enabled: true },
    },
    advanced: {
      database: { generateId: () => randomUUID() },
      // better-auth throttles sign-in and reset per client IP — the brute-force and
      // enumeration defence. It reads the socket address by default, which is the
      // proxy, collapsing every client into one bucket. Point it at the forwarded
      // header, but only when we have said the proxy is trusted (see TRUST_PROXY):
      // otherwise a direct client could spoof the header and dodge the limit.
      ...(trustsForwardedIp ? { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } } : {}),
      // Spelled out rather than inherited. better-auth would infer `Secure` from
      // the baseURL's scheme on its own, but a session cookie is the one credential
      // the whole app rests on, and "it depends what someone put in an env var" is
      // not a thing to leave implicit. Boot refuses an http production URL unless
      // ALLOW_INSECURE_HTTP says otherwise, so this follows the same fact.
      //
      // SameSite=Lax is what stops a cross-site POST from carrying the session, and
      // it works because the SPA and the API are served from one origin in
      // production (nginx proxies /api to the API service) — see docs/operations.
      useSecureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: useSecureCookies,
      },
    },
    emailAndPassword: {
      enabled: true,
      // Public self-service sign-up is off unless asked for. Accounts are created
      // by an admin or by invitation; the invite flow sets a password through the
      // reset endpoint, not sign-up, so it is unaffected. See ALLOW_REGISTRATION.
      disableSignUp: !env.ALLOW_REGISTRATION,
      minPasswordLength: settings.passwordPolicy.minLength,
      sendResetPassword: async ({ user, url }) => {
        // An invitation is sent through this same mechanism — `sendSetPasswordLink`
        // calls requestPasswordReset — so the two are told apart by where the link
        // lands. Without this the log would report every invitation as a password
        // reset, and "did their invite go out?" would have no answer again.
        //
        // No leading slash in the match: the destination arrives inside the reset
        // link as an encoded `callbackURL`, where the slash is `%2F`.
        const invited = url.includes("accept-invite");
        const kind = invited ? "invite" : "password-reset";
        await enqueueEmail(
          { to: user.email, ...(invited ? inviteEmail(url) : resetPasswordEmail(url)) },
          { kind, toUserId: user.id },
        );
      },
    },
    // Complexity and reuse live here: `emailAndPassword` understands only minLength.
    hooks: {
      before: passwordPolicyHook(settings.passwordPolicy),
    },
    // Record every password the credential account is given, whichever endpoint
    // wrote it. Hooking the row rather than the routes means a new password path
    // cannot quietly bypass the reuse and expiry rules.
    databaseHooks: {
      // A login name is required and unique, but better-auth creates users on
      // paths that never ask for one — a public sign-up, and an OIDC sign-in.
      // Filling it here means no path can produce an account without one, rather
      // than the rule holding only for the forms we happen to own.
      user: {
        create: {
          before: async (user) => {
            const draft = user as typeof user & { username?: string | null };
            if (draft.username) return;
            const generated = await uniqueUsername(draft.email);
            return { data: { ...user, username: generated, displayUsername: generated } };
          },
        },
      },
      // Refuse a session to a deactivated account. This runs only once the
      // credentials have already verified, so it tells an attacker guessing
      // addresses nothing they did not already know.
      session: {
        create: {
          before: async (session) => {
            if (!(await isUserActive(session.userId))) return false;
          },
        },
      },
      account: {
        create: {
          after: async (account) => {
            if (account.providerId === CREDENTIAL_PROVIDER && account.password) {
              await recordCurrentPassword(account.userId);
            }
          },
        },
        update: {
          after: async (account) => {
            // OAuth token refreshes update accounts too; only credentials matter.
            if (account.providerId === CREDENTIAL_PROVIDER && account.password) {
              await recordCurrentPassword(account.userId);
              // They have now chosen a password of their own, so the
              // administrator-set one no longer gates them. Hooking the row rather
              // than each route means a new password path cannot forget to.
              await clearMustChangePassword(account.userId);
            }
          },
        },
      },
    },
    // NOTE: better-auth's `admin()` plugin is deliberately NOT mounted. It
    // publishes ~15 routes under /auth/admin/* that authorize on a `users.role`
    // column rather than on our groups and can(), so they bypassed the password
    // policy, wrote no audit events, and maintained a second `banned` status
    // beside our own. Session listing — the one thing we wanted from it — lives
    // on /users/:id/sessions, gated and audited like every other route.
    plugins: [
      // Lets a person sign in with their login name instead of their email. It is
      // authentication only — no authorization surface of its own — which is why
      // it is mounted where admin() is not. The rules mirror usernameSchema in
      // the shared contract, so the API and the forms reject the same names.
      usernamePlugin({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        usernameValidator: (value) => /^[a-z0-9._-]+$/.test(value),
      }),
      twoFactor({ issuer: "Reportly" }),
      genericOAuth({ config: oauthConfigs }),
      // Supplies `generateOpenAPISchema()`, which core/docs.ts merges into the
      // main spec. Its own reference page is disabled: it loads Scalar from a CDN
      // that our Content-Security-Policy blocks, so it renders blank.
      openAPI({ disableDefaultReference: true }),
    ],
  });
}

// Starts with registry defaults and no SSO providers so importing this never
// requires a database (DB-free unit tests). reloadAuth() loads the real config.
let instance = createAuth([], defaultAuthSettings());

export function getAuth(): ReturnType<typeof createAuth> {
  return instance;
}

/**
 * Rebuild the auth instance from the current settings + enabled SSO providers.
 * Called at startup and after any auth setting or SSO provider changes, so
 * password policy, session lifetime, rate limits, and providers all take effect
 * without a redeploy.
 */
export async function reloadAuth(): Promise<void> {
  const [passwordPolicy, session, rateLimit, oauthConfigs] = await Promise.all([
    getSystemSetting(PASSWORD_POLICY),
    getSystemSetting(SESSION_SETTINGS),
    getSystemSetting(AUTH_RATE_LIMIT),
    buildOAuthConfigs(),
  ]);
  instance = createAuth(oauthConfigs, { passwordPolicy, session, rateLimit });
}
