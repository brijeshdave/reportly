// Author: Brijesh Dave <https://github.com/brijeshdave>
// The sign-in throttle, and the bug that prompted it.
//
// Reported from production: "some users are not being able to login with correct
// credentials". The limiter keyed on IP alone, so behind one office NAT — or one
// reverse proxy — every person shared a single allowance, and one colleague fumbling
// their password refused correct passwords for the whole floor. Nothing was recorded
// and there was no way to release anybody.
import { AUTH_RATE_LIMIT } from "@reportly/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  consumeLoginAttempt,
  release,
  throttleKey,
  throttleState,
} from "@/core/auth/login-throttle.js";
import { appPool, logPool } from "@/core/db/pool.js";
import { redis } from "@/core/redis.js";
import { setSystemSetting } from "@/core/settings/service.js";
import { resetDb } from "../../../../test/reset-db.js";

afterAll(async () => {
  await appPool.end();
  await logPool.end();
});

beforeEach(async () => {
  await resetDb();
  await setSystemSetting(AUTH_RATE_LIMIT, { signInMax: 3, signInWindowSeconds: 60 });
});

/** Spend the allowance for one identity at one address. */
async function exhaust(identity: string, ip: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await consumeLoginAttempt(identity, ip, "sign-in");
  }
}

describe("the sign-in throttle", () => {
  it("locks the account that is failing, not the address it is failing from", async () => {
    // The whole point. Two people, one office IP.
    const ip = "203.0.113.7";
    await exhaust("banti.patel", ip);

    await expect(consumeLoginAttempt("banti.patel", ip, "sign-in")).rejects.toMatchObject({
      statusCode: 429,
    });

    // Their colleague, on the same address, is unaffected.
    await expect(consumeLoginAttempt("shakil.pathan", ip, "sign-in")).resolves.toMatchObject({
      locked: false,
    });
  });

  it("still counts per address, so one username cannot be attacked from everywhere", async () => {
    // The other half: without the IP in the key, knowing somebody's username would be
    // enough to lock them out from anywhere — a nuisance turned into a weapon.
    await exhaust("banti.patel", "203.0.113.7");
    await expect(
      consumeLoginAttempt("banti.patel", "198.51.100.9", "sign-in"),
    ).resolves.toMatchObject({ locked: false });
  });

  it("treats one person's name as one allowance whatever the capitalisation", async () => {
    await exhaust("Banti.Patel", "203.0.113.7");
    await expect(
      consumeLoginAttempt("banti.patel", "203.0.113.7", "sign-in"),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("reports the lock so an administrator can see it", async () => {
    await exhaust("banti.patel", "203.0.113.7");
    const state = await throttleState("banti.patel");
    expect(state.locked).toBe(true);
    expect(state.attempts).toBe(3);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("lets somebody back in, across every door they burned", async () => {
    const ip = "203.0.113.7";
    await exhaust("banti.patel", ip);
    // Locked out, they try the password-reset door too, as people do.
    await consumeLoginAttempt("banti.patel", ip, "password-reset");

    const cleared = await release("banti.patel");
    expect(cleared).toBeGreaterThanOrEqual(2);

    expect((await throttleState("banti.patel")).locked).toBe(false);
    await expect(consumeLoginAttempt("banti.patel", ip, "sign-in")).resolves.toMatchObject({
      locked: false,
    });
  });

  it("releases by address as well, for a site locked out behind one gateway", async () => {
    await exhaust("banti.patel", "203.0.113.7");
    await exhaust("shakil.pathan", "203.0.113.7");

    expect(await release("203.0.113.7")).toBeGreaterThanOrEqual(2);
    expect((await throttleState("banti.patel")).locked).toBe(false);
    expect((await throttleState("shakil.pathan")).locked).toBe(false);
  });

  it("lets the request through when Redis cannot be reached", async () => {
    // Failing closed would turn a cache outage into an installation nobody can enter.
    const key = throttleKey("banti.patel", "203.0.113.7", "sign-in");
    await redis.set(key, "not-a-number");
    await expect(
      consumeLoginAttempt("banti.patel", "203.0.113.7", "sign-in"),
    ).resolves.toBeDefined();
  });
});
