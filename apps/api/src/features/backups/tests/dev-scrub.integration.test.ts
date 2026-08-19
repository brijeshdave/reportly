// Author: Brijesh Dave <https://github.com/brijeshdave>
// A scrub that misses a column looks exactly like one that works — right up until
// the afternoon somebody's development box emails a customer. So this plants every
// kind of thing the scrub is supposed to remove, runs it, and asserts each one is
// gone; and plants the things it must *keep*, because a scrub that empties the
// database is safe and useless.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { buildApp } from "@/core/app.js";
import { resetSuperadmin } from "@/core/auth/reset-superadmin.js";
import { db } from "@/core/db/index.js";
import { DEV_PASSWORD, scrubForDevelopment } from "@/features/backups/dev-scrub.js";
import { resetDb } from "../../../../test/reset-db.js";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
});

const SUPERADMIN = "00000000-0000-0000-0000-000000000001";

/** Everything a production dump would bring with it. */
async function plantProductionData(): Promise<void> {
  // The seed leaves the superadmin without a credential row until a password is
  // set, and a dump from production certainly has one — so make it real first.
  await resetSuperadmin();
  await db.execute(sql`
    UPDATE users
       SET email = 'priya@realcompany.example',
           mobile = '+919876543210',
           discord_handle = 'priya#4242',
           whatsapp_on_mobile = true,
           telegram_on_mobile = true,
           mobile_verified_at = now(),
           two_factor_enabled = true,
           must_change_password = true
     WHERE id = ${SUPERADMIN}
  `);
  await db.execute(sql`
    UPDATE accounts
       SET password = 'production-argon2-hash',
           access_token = 'ya29.live-access-token',
           refresh_token = 'live-refresh-token',
           id_token = 'live-id-token'
     WHERE user_id = ${SUPERADMIN} AND provider_id = 'credential'
  `);
  await db.execute(sql`
    INSERT INTO two_factors (id, user_id, secret, backup_codes)
    VALUES ('11111111-2222-3333-4444-555555555555', ${SUPERADMIN}, 'JBSWY3DPEHPK3PXP', '[]')
  `);
  await db.execute(sql`
    INSERT INTO password_history (id, user_id, password_hash)
    VALUES (gen_random_uuid(), ${SUPERADMIN}, 'an-old-production-hash')
  `);
  await db.execute(sql`
    INSERT INTO sessions (id, user_id, token, expires_at)
    VALUES (gen_random_uuid(), ${SUPERADMIN}, 'a-live-session-token', now() + interval '1 day')
  `);
  await db.execute(sql`
    INSERT INTO verifications (id, identifier, value, expires_at)
    VALUES (gen_random_uuid(), 'priya@realcompany.example', 'a-live-token', now() + interval '1 day')
  `);
  await db.execute(sql`
    INSERT INTO notification_preferences (id, user_id, type, channel, enabled)
    VALUES (gen_random_uuid(), ${SUPERADMIN}, 'task.assigned', 'email', true)
  `);
  await db.execute(sql`
    UPDATE settings
       SET value = '{"telegramBotToken":"123:REAL","twilioAuthToken":"real-token"}'::jsonb
     WHERE namespace = 'channels' AND key = 'providers'
  `);
  await db.execute(sql`
    UPDATE settings
       SET value = '{"issuer":"https://real","enabled":true,"clientId":"id","clientSecret":"REAL-SECRET"}'::jsonb
     WHERE namespace = 'sso' AND key = 'google'
  `);
}

const one = async (query: ReturnType<typeof sql>): Promise<Record<string, unknown> | undefined> =>
  (await db.execute<Record<string, unknown>>(query)).rows[0];

describe("scrubbing a production copy for development", () => {
  it("leaves nothing that could reach a real person", async () => {
    await plantProductionData();
    const report = await scrubForDevelopment();

    const user = await one(sql`
      SELECT email, mobile, discord_handle, whatsapp_on_mobile, telegram_on_mobile,
             two_factor_enabled, must_change_password
        FROM users WHERE id = ${SUPERADMIN}
    `);
    // The local part survives so you still know whose account it is; the domain
    // cannot reach anybody.
    expect(user?.email).toBe("priya@dev.local");
    expect(user?.mobile).toBeNull();
    expect(user?.discord_handle).toBeNull();
    expect(user?.whatsapp_on_mobile).toBe(false);
    expect(user?.telegram_on_mobile).toBe(false);
    expect(user?.two_factor_enabled).toBe(false);
    expect(user?.must_change_password).toBe(false);

    const account = await one(sql`
      SELECT password, access_token, refresh_token, id_token
        FROM accounts WHERE user_id = ${SUPERADMIN} AND provider_id = 'credential'
    `);
    expect(account?.password).not.toBe("production-argon2-hash");
    expect(account?.access_token).toBeNull();
    expect(account?.refresh_token).toBeNull();
    expect(account?.id_token).toBeNull();

    for (const table of ["two_factors", "password_history", "sessions", "verifications"]) {
      const row = await one(sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`);
      expect({ table, n: row?.n }).toEqual({ table, n: 0 });
    }

    // Outbound, both layers: the app-wide switch and what people chose themselves.
    const delivery = await one(sql`
      SELECT value FROM settings WHERE namespace = 'notifications' AND key = 'delivery'
    `);
    expect(delivery?.value).toMatchObject({
      emailEnabled: false,
      whatsappEnabled: false,
      telegramEnabled: false,
      discordEnabled: false,
      mobileEnabled: false,
      inappEnabled: true,
    });
    const stillOn = await one(sql`
      SELECT count(*)::int AS n FROM notification_preferences
       WHERE channel <> 'inapp' AND enabled
    `);
    expect(stillOn?.n).toBe(0);

    // Credentials in settings are gone entirely, not blanked in place.
    const secrets = await one(sql`
      SELECT count(*)::int AS n FROM settings
       WHERE (namespace = 'channels' AND key = 'providers')
          OR (namespace = 'sso' AND key = 'google')
    `);
    expect(secrets?.n).toBe(0);
    expect(report.settingsCleared).toContain("channels.providers");
    expect(report.settingsCleared).toContain("sso.google");
  });

  it("lets you sign in as anybody with the development password", async () => {
    await plantProductionData();
    await scrubForDevelopment();

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in/email",
      payload: { email: "priya@dev.local", password: DEV_PASSWORD },
    });
    // The whole point of resetting the password: a copy you cannot sign into is a
    // copy you cannot work in.
    expect(res.statusCode).toBe(200);
  });

  it("keeps the work that makes the copy worth having", async () => {
    await plantProductionData();
    const before = await one(sql`SELECT count(*)::int AS n FROM departments`);
    await scrubForDevelopment();
    const after = await one(sql`SELECT count(*)::int AS n FROM departments`);

    // A scrub that empties the database is perfectly safe and completely useless.
    expect(after?.n).toBe(before?.n);
    expect(Number(after?.n)).toBeGreaterThan(0);
  });

  it("can be run twice without mangling the emails it already moved", async () => {
    await plantProductionData();
    await scrubForDevelopment();
    await scrubForDevelopment();

    const user = await one(sql`SELECT email FROM users WHERE id = ${SUPERADMIN}`);
    expect(user?.email).toBe("priya@dev.local");
  });
});
