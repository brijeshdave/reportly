// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shared TanStack Query options. Defining them once keeps cache keys consistent
// between route loaders (which prefetch) and components (which read).
import { queryOptions } from "@tanstack/react-query";

import { fetchAuthConfig, fetchEnabledSsoProviders } from "@/services/auth.js";
import { fetchDebugStatus } from "@/services/debug.js";
import { fetchSession } from "@/services/session.js";
import { fetchUnreadCount } from "@/services/notifications.js";
import { fetchMyPreferences, fetchPasswordRules } from "@/services/settings.js";

export const queryKeys = {
  session: ["session"] as const,
  preferences: ["preferences"] as const,
  debug: ["debug"] as const,
  ssoProviders: ["sso-providers"] as const,
  passwordRules: ["password-rules"] as const,
  authConfig: ["auth-config"] as const,
  notifications: ["notifications"] as const,
  unreadCount: ["notifications", "unread"] as const,
  notificationPreferences: ["notification-preferences"] as const,
};

export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: fetchSession,
  // A 401 is a normal signed-out state, not a transient failure.
  retry: false,
  staleTime: 30_000,
  /**
   * The one query that refetches when the tab is focused again.
   *
   * `refetchOnWindowFocus` is off across the app on purpose — the API is the source
   * of truth and does not need asking on every alt-tab. This is the exception,
   * because it carries what the person is *allowed to do*: when an administrator
   * grants a site or a role, the change is live on the server immediately (the auth
   * context is read per request, never cached), and the only thing left holding the
   * old answer is this cache. Coming back to the tab is exactly when somebody
   * expects "they just fixed my access" to have taken effect.
   */
  refetchOnWindowFocus: true,
});

export const preferencesQuery = queryOptions({
  queryKey: queryKeys.preferences,
  queryFn: fetchMyPreferences,
  retry: false,
  staleTime: 5 * 60_000,
});

export const debugQuery = queryOptions({
  queryKey: queryKeys.debug,
  queryFn: fetchDebugStatus,
  retry: false,
  staleTime: 30_000,
});

/** Both are public and change rarely; the auth screens read them on mount. */
export const ssoProvidersQuery = queryOptions({
  queryKey: queryKeys.ssoProviders,
  queryFn: fetchEnabledSsoProviders,
  retry: false,
  staleTime: 5 * 60_000,
});

/** Public: whether the login screen offers a register link. */
export const authConfigQuery = queryOptions({
  queryKey: queryKeys.authConfig,
  queryFn: fetchAuthConfig,
  retry: false,
  staleTime: 5 * 60_000,
});

export const passwordRulesQuery = queryOptions({
  queryKey: queryKeys.passwordRules,
  queryFn: fetchPasswordRules,
  retry: false,
  staleTime: 5 * 60_000,
});

/**
 * The bell's badge.
 *
 * The one polled query in the app. Everything else is fetched when a screen asks
 * for it, but a notification arrives while you are looking at something else, and
 * a bell that only updates on navigation is a bell that lies to anyone who stays
 * on one page. Sixty seconds is slow enough to be nearly free — the endpoint
 * counts an indexed column and returns one integer — and fast enough that nobody
 * notices the delay.
 *
 * A transport would be better and is not worth its cost here: this is a
 * single-tenant self-hosted app with a handful of tabs open, not a fan-out
 * problem.
 */
export const unreadCountQuery = queryOptions({
  queryKey: queryKeys.unreadCount,
  queryFn: fetchUnreadCount,
  retry: false,
  refetchInterval: 60_000,
  // Somebody coming back to a tab they left open wants the truth immediately,
  // not up to a minute later.
  refetchOnWindowFocus: true,
  staleTime: 30_000,
});
