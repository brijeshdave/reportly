// Author: Brijesh Dave <https://github.com/brijeshdave>
// The step machine decides when a user is signed in, so every transition — and
// every transition that must NOT happen — is pinned here.
import { describe, expect, it } from "vitest";

import {
  initialLoginState,
  isChallenge,
  loginReducer,
  type LoginEvent,
  type LoginState,
} from "@/lib/auth-machine.js";

const state = (step: LoginState["step"]): LoginState => ({ step });
const run = (from: LoginState, ...events: LoginEvent[]) => events.reduce(loginReducer, from);

describe("loginReducer", () => {
  it("signs in directly when the account has no 2FA", () => {
    const next = loginReducer(initialLoginState, {
      type: "credentials-accepted",
      twoFactorRequired: false,
    });
    expect(next.step).toBe("done");
  });

  it("challenges for a TOTP code when the account has 2FA", () => {
    const next = loginReducer(initialLoginState, {
      type: "credentials-accepted",
      twoFactorRequired: true,
    });
    expect(next.step).toBe("totp");
  });

  it("swaps between the authenticator and recovery code entry", () => {
    const recovery = run(state("totp"), { type: "use-recovery-code" });
    expect(recovery.step).toBe("recovery");
    expect(run(recovery, { type: "use-authenticator" }).step).toBe("totp");
  });

  it("completes sign-in from either challenge", () => {
    expect(run(state("totp"), { type: "verified" }).step).toBe("done");
    expect(run(state("recovery"), { type: "verified" }).step).toBe("done");
  });

  it("never lets a verification skip the password step", () => {
    expect(run(initialLoginState, { type: "verified" })).toEqual(initialLoginState);
  });

  it("ignores a second credentials-accepted while a challenge is pending", () => {
    const challenged = state("totp");
    const next = loginReducer(challenged, {
      type: "credentials-accepted",
      twoFactorRequired: false,
    });
    expect(next).toEqual(challenged);
  });

  it("ignores recovery/authenticator toggles outside a challenge", () => {
    expect(run(initialLoginState, { type: "use-recovery-code" })).toEqual(initialLoginState);
    expect(run(state("done"), { type: "use-authenticator" }).step).toBe("done");
  });

  it("returns to the credentials step on restart", () => {
    expect(run(state("recovery"), { type: "restart" })).toEqual(initialLoginState);
  });
});

describe("isChallenge", () => {
  it("is true only while a 2FA code is expected", () => {
    expect(isChallenge(state("totp"))).toBe(true);
    expect(isChallenge(state("recovery"))).toBe(true);
    expect(isChallenge(initialLoginState)).toBe(false);
    expect(isChallenge(state("done"))).toBe(false);
  });
});
