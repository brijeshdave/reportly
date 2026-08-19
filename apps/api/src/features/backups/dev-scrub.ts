// Author: Brijesh Dave <https://github.com/brijeshdave>
// Making a production copy safe to work in.
//
// The danger this exists for is not the data sitting in the tables — it is that a
// development server loaded with production data still believes it *is*
// production. It has the reminder cron, the notification queue and six channels
// pointed at real addresses. Left alone for a minute, the first scheduled job
// emails, WhatsApps and Telegrams real staff and customers from somebody's laptop.
//
// So this runs in **one transaction, in the same command as the restore**, and it
// severs outbound as well as erasing secrets. Never a restore followed by a
// cleanup script somebody remembers to run.
//
// What deliberately survives is everything that makes the copy worth having:
// journal entries, routines, rotas, assets, departments, points, and the audit
// trail — which by this project's rule carries no personal data in the first place.
import { sql } from "drizzle-orm";

import { getAuth } from "@/core/auth/auth.js";
import { db } from "@/core/db/index.js";

/** The password every local account is given, so you can sign in as anybody. */
export const DEV_PASSWORD = "Admin@123";

/** What the scrub changed, so the command can say it rather than claim it. */
export interface ScrubReport {
  passwordsReset: number;
  twoFactorRemoved: number;
  sessionsDropped: number;
  emailsRewritten: number;
  contactDetailsCleared: number;
  oidcTokensCleared: number;
  passwordHistoryDropped: number;
  verificationsDropped: number;
  notificationPreferencesReset: number;
  settingsCleared: string[];
}

/**
 * Settings rows whose values are credentials.
 *
 * Deleted rather than blanked, so the app falls back to its shipped default and
 * the integration is *visibly* absent. A half-emptied provider block is an
 * integration that looks configured and fails at the worst moment.
 *
 * `channels.providers` holds the Twilio account and auth token, the Telegram and
 * Discord bot tokens; each `sso.*` row holds an OIDC client secret. Checked
 * against the settings registry rather than guessed — `storage.uploads` and
 * `backups.*` turn out to hold only limits and schedules, so they stay.
 */
const SECRET_SETTINGS: readonly (readonly [string, string])[] = [
  ["channels", "providers"],
  ["sso", "auth0"],
  ["sso", "authentik"],
  ["sso", "clerk"],
  ["sso", "google"],
  ["sso", "microsoft"],
];

/**
 * Scrub a freshly restored production database into a development one.
 *
 * One transaction: a half-scrubbed database is a production database with a
 * misleading name on it.
 */
export async function scrubForDevelopment(): Promise<ScrubReport> {
  // better-auth owns the hashing scheme; borrowing its hasher is what keeps the
  // written hash something the sign-in path will actually accept.
  const hashed = await (await getAuth().$context).password.hash(DEV_PASSWORD);

  return db.transaction(async (tx) => {
    const count = async (query: ReturnType<typeof sql>): Promise<number> => {
      const result = await tx.execute<{ n: number }>(query);
      return Number(result.rows[0]?.n ?? 0);
    };

    // --- credentials -------------------------------------------------------
    //
    // Only local accounts get the development password: an OIDC-linked account has
    // no local password to set, and giving it one would invent a way in that
    // production does not have.
    const passwordsReset = await count(sql`
      WITH updated AS (
        UPDATE accounts SET password = ${hashed}, updated_at = now()
        WHERE provider_id = 'credential' AND password IS NOT NULL
        RETURNING 1
      ) SELECT count(*)::int AS n FROM updated
    `);

    // Their provider tokens are live credentials at the identity provider.
    const oidcTokensCleared = await count(sql`
      WITH updated AS (
        UPDATE accounts
           SET access_token = NULL, refresh_token = NULL, id_token = NULL,
               access_token_expires_at = NULL, refresh_token_expires_at = NULL,
               updated_at = now()
         WHERE access_token IS NOT NULL OR refresh_token IS NOT NULL OR id_token IS NOT NULL
        RETURNING 1
      ) SELECT count(*)::int AS n FROM updated
    `);

    // A TOTP secret is a credential, and nobody has the phone that made it.
    const twoFactorRemoved = await count(sql`
      WITH deleted AS (DELETE FROM two_factors RETURNING 1)
      SELECT count(*)::int AS n FROM deleted
    `);
    await tx.execute(sql`UPDATE users SET two_factor_enabled = false WHERE two_factor_enabled`);

    // Nobody stays signed in through a restore, and a pending verification is a
    // token somebody could still use.
    const sessionsDropped = await count(sql`
      WITH deleted AS (DELETE FROM sessions RETURNING 1) SELECT count(*)::int AS n FROM deleted
    `);
    const verificationsDropped = await count(sql`
      WITH deleted AS (DELETE FROM verifications RETURNING 1) SELECT count(*)::int AS n FROM deleted
    `);
    await tx.execute(sql`DELETE FROM channel_verifications`);

    // A list of real password hashes is exactly the thing not to carry about.
    const passwordHistoryDropped = await count(sql`
      WITH deleted AS (DELETE FROM password_history RETURNING 1)
      SELECT count(*)::int AS n FROM deleted
    `);

    // Nobody should land on "you must change your password" in a copy where the
    // password is written in the documentation.
    await tx.execute(sql`UPDATE users SET must_change_password = false WHERE must_change_password`);

    // --- who people are ----------------------------------------------------
    //
    // The local part is kept and the domain replaced: you still know who everyone
    // is and can sign in as them, and no address in the database reaches a real
    // person. Idempotent — running it twice does not stack ".dev.local" endlessly.
    const emailsRewritten = await count(sql`
      WITH updated AS (
        UPDATE users
           SET email = split_part(email, '@', 1) || '@dev.local', updated_at = now()
         WHERE email NOT LIKE '%@dev.local'
        RETURNING 1
      ) SELECT count(*)::int AS n FROM updated
    `);

    // Phone numbers and handles reach people directly, and nothing in development
    // needs them to be real.
    const contactDetailsCleared = await count(sql`
      WITH updated AS (
        UPDATE users
           SET mobile = NULL, discord_handle = NULL,
               whatsapp_on_mobile = false, telegram_on_mobile = false,
               mobile_verified_at = NULL, whatsapp_verified_at = NULL,
               telegram_verified_at = NULL, discord_verified_at = NULL,
               updated_at = now()
         WHERE mobile IS NOT NULL OR discord_handle IS NOT NULL
        RETURNING 1
      ) SELECT count(*)::int AS n FROM updated
    `);

    // --- outbound, severed -------------------------------------------------
    //
    // Two layers, because either alone leaves a way out. The delivery setting is
    // the app-wide switch per channel; the per-person preferences are what people
    // chose for themselves. Both go to in-app only, so the bell still works and
    // nothing reaches a phone or an inbox.
    await tx.execute(sql`
      UPDATE settings
         SET value = value
               || '{"emailEnabled":false,"mobileEnabled":false,"whatsappEnabled":false,
                    "telegramEnabled":false,"discordEnabled":false,"inappEnabled":true}'::jsonb,
             updated_at = now()
       WHERE namespace = 'notifications' AND key = 'delivery'
    `);

    // A row per person per type per channel — so this is "switch off every channel
    // that leaves the building", not a column update.
    const notificationPreferencesReset = await count(sql`
      WITH updated AS (
        UPDATE notification_preferences SET enabled = false, updated_at = now()
         WHERE channel <> 'inapp' AND enabled
        RETURNING 1
      ) SELECT count(*)::int AS n FROM updated
    `);

    const settingsCleared: string[] = [];
    for (const [namespace, key] of SECRET_SETTINGS) {
      const removed = await count(sql`
        WITH deleted AS (
          DELETE FROM settings WHERE namespace = ${namespace} AND key = ${key} RETURNING 1
        ) SELECT count(*)::int AS n FROM deleted
      `);
      if (removed > 0) settingsCleared.push(`${namespace}.${key}`);
    }

    return {
      passwordsReset,
      twoFactorRemoved,
      sessionsDropped,
      emailsRewritten,
      contactDetailsCleared,
      oidcTokensCleared,
      passwordHistoryDropped,
      verificationsDropped,
      notificationPreferencesReset,
      settingsCleared,
    };
  });
}
