// Author: Brijesh Dave <https://github.com/brijeshdave>
// Throttling the credential endpoints, keyed by **who is being tried, and from where**.
//
// This replaces better-auth's own limiter on those paths, for three reasons its
// version could not give us:
//
//   1. **It keyed on IP alone.** Behind one office NAT — or one reverse proxy — every
//      person shares a bucket, so one colleague fumbling their password refuses
//      correct credentials for the whole floor. Reported from production, and the
//      hardest kind of fault to diagnose because nothing is wrong with the account.
//   2. **Nothing was recorded.** A throttled attempt left no trace, so "why could I
//      not sign in at 09:40?" had no answer.
//   3. **There was no way out.** No release, no visibility, nothing but waiting.
//
// The bucket is `username + IP`, so an account's own mistakes cost that account.
// The IP stays in the key as well: without it, knowing somebody's username would be
// enough to lock them out from anywhere, which trades a nuisance for a weapon.
//
// Fails **open**: if Redis is unreachable the attempt proceeds. A sign-in that cannot
// be counted is better than an installation that cannot be entered.
import { AUTH_RATE_LIMIT, ERROR_CODES } from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { logger } from "@/core/logger.js";
import { redis } from "@/core/redis.js";
import { getSystemSetting } from "@/core/settings/service.js";

/** The credential doors worth counting, and what each is called in the audit trail. */
export const THROTTLED_PATHS: Record<string, string> = {
  "/sign-in/email": "sign-in",
  "/sign-in/username": "sign-in",
  "/forget-password": "password-reset",
  "/two-factor/verify-totp": "two-factor",
};

const PREFIX = "login-throttle";

/**
 * One bucket per identity per address.
 *
 * The identity is lower-cased so `Banti.Patel` and `banti.patel` are one person
 * rather than two allowances — the sign-in itself is case-insensitive, and a limiter
 * that is not would be trivially side-stepped.
 */
export function throttleKey(identity: string | null, ip: string, door: string): string {
  const who = (identity ?? "anonymous").trim().toLowerCase();
  return `${PREFIX}:${door}:${who}:${ip}`;
}

export interface ThrottleState {
  attempts: number;
  max: number;
  /** Seconds until the window clears. Null when nothing is counted. */
  retryAfterSeconds: number | null;
  locked: boolean;
}

/** What the limiter currently thinks of one identity, without counting an attempt. */
export async function throttleState(identity: string, ip = "*"): Promise<ThrottleState> {
  const { signInMax } = await getSystemSetting(AUTH_RATE_LIMIT);
  const pattern = throttleKey(identity, ip, "sign-in");

  try {
    const keys =
      ip === "*" ? await scanKeys(`${PREFIX}:sign-in:${identity.toLowerCase()}:*`) : [pattern];
    let worst: ThrottleState = {
      attempts: 0,
      max: signInMax,
      retryAfterSeconds: null,
      locked: false,
    };
    for (const key of keys) {
      const [count, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
      const attempts = Number(count ?? 0);
      if (attempts > worst.attempts) {
        worst = {
          attempts,
          max: signInMax,
          retryAfterSeconds: ttl > 0 ? ttl : null,
          locked: attempts >= signInMax,
        };
      }
    }
    return worst;
  } catch {
    return { attempts: 0, max: signInMax, retryAfterSeconds: null, locked: false };
  }
}

/** Every key for one identity, or for one address — what `release` clears. */
async function scanKeys(pattern: string): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
    found.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return found;
}

/**
 * Let somebody back in.
 *
 * Takes a username or an IP and clears every bucket it appears in, across all four
 * doors — somebody locked out of sign-in has usually also burned their password-reset
 * allowance trying to fix it themselves.
 */
export async function release(identityOrIp: string): Promise<number> {
  const needle = identityOrIp.trim().toLowerCase();
  try {
    const keys = [
      ...(await scanKeys(`${PREFIX}:*:${needle}:*`)),
      ...(await scanKeys(`${PREFIX}:*:*:${needle}`)),
    ];
    if (keys.length === 0) return 0;
    await redis.del(...new Set(keys));
    return keys.length;
  } catch (error) {
    logger.warn({ err: error, identityOrIp }, "Could not clear the login throttle");
    return 0;
  }
}

/**
 * Everybody the limiter is currently holding out, keyed by the identity they typed.
 *
 * One SCAN for the whole page rather than a lookup per row: a users table asking
 * Redis twenty times to draw twenty badges is a table that gets slower the more
 * people you have. The identity is whatever was typed at the login form — an email
 * or a username — and matching it to a person is the caller's job, because only the
 * caller knows which of those it stores.
 *
 * Locked entries only. A counter at one attempt out of five is not a state anybody
 * needs told about, and showing it would make the badge meaningless.
 */
export async function lockedIdentities(): Promise<Map<string, ThrottleState>> {
  const { signInMax } = await getSystemSetting(AUTH_RATE_LIMIT);
  const locked = new Map<string, ThrottleState>();

  try {
    for (const key of await scanKeys(`${PREFIX}:sign-in:*`)) {
      // `prefix:door:identity:ip` — and an identity may itself contain a colon in
      // theory, so take the address off the end rather than splitting from the left.
      const parts = key.split(":");
      const identity = parts.slice(2, -1).join(":");
      if (!identity) continue;

      const attempts = Number((await redis.get(key)) ?? 0);
      if (attempts < signInMax) continue;

      const ttl = await redis.ttl(key);
      const worst = locked.get(identity);
      if (worst && worst.attempts >= attempts) continue;
      locked.set(identity, {
        attempts,
        max: signInMax,
        retryAfterSeconds: ttl > 0 ? ttl : null,
        locked: true,
      });
    }
  } catch (error) {
    // The same reasoning as everywhere else here: a cache that cannot answer must
    // not take the screen down with it. An empty map draws no badges.
    logger.warn({ err: error }, "Could not read the login throttle");
  }

  return locked;
}

/**
 * Refuse the attempt when the allowance is already spent — **without counting it**.
 *
 * Only *failures* are counted (see `recordFailure`), because a lockout is a defence
 * against guessing and a correct password is not a guess. Counting every attempt
 * meant six legitimate sign-ins in a minute — two tabs, a phone, a test suite —
 * locked somebody out while typing the right password, which is the complaint this
 * whole change exists to fix, merely narrowed from the office to one person.
 */
export async function assertNotLockedOut(
  identity: string | null,
  ip: string,
  door: string,
): Promise<void> {
  const { signInMax, signInWindowSeconds } = await getSystemSetting(AUTH_RATE_LIMIT);
  const key = throttleKey(identity, ip, door);

  let attempts: number;
  let ttl = signInWindowSeconds;
  try {
    attempts = Number((await redis.get(key)) ?? 0);
    if (attempts > 0) ttl = await redis.ttl(key);
  } catch {
    return; // fails open — see the note at the top of the file
  }

  if (attempts >= signInMax) {
    throw new AppError(
      429,
      ERROR_CODES.RATE_LIMITED,
      `Too many failed attempts. Try again in ${ttl > 0 ? ttl : signInWindowSeconds}s, or ask an administrator to release the lock.`,
    );
  }
}

/**
 * Count a failure. Called only when the credentials were actually refused.
 *
 * Returns the state so the caller can say, in the audit trail, how close to the limit
 * this attempt came.
 */
export async function recordFailure(
  identity: string | null,
  ip: string,
  door: string,
): Promise<ThrottleState> {
  const { signInMax, signInWindowSeconds } = await getSystemSetting(AUTH_RATE_LIMIT);
  const key = throttleKey(identity, ip, door);

  try {
    const attempts = await redis.incr(key);
    if (attempts === 1) await redis.expire(key, signInWindowSeconds);
    const ttl = await redis.ttl(key);
    return {
      attempts,
      max: signInMax,
      retryAfterSeconds: ttl > 0 ? ttl : signInWindowSeconds,
      locked: attempts >= signInMax,
    };
  } catch {
    return { attempts: 0, max: signInMax, retryAfterSeconds: null, locked: false };
  }
}

/** Forget the count once somebody proves who they are — a success is not an attack. */
export async function clearOnSuccess(identity: string | null, ip: string): Promise<void> {
  if (!identity) return;
  try {
    await redis.del(throttleKey(identity, ip, "sign-in"), throttleKey(identity, ip, "two-factor"));
  } catch {
    // Nothing to do: the window will expire on its own.
  }
}
