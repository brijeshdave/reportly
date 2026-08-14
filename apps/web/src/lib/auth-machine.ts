// Author: Brijesh Dave <https://github.com/brijeshdave>
// The sign-in step machine. Kept pure and separate from the form so the
// transitions can be tested without rendering, and so an event that makes no
// sense for the current step (a stale click, a double submit) cannot advance it.

/** Where the user is in the sign-in flow. */
export type LoginStep =
  /** Entering email + password. */
  | "credentials"
  /** 2FA required: entering a code from the authenticator app. */
  | "totp"
  /** 2FA required: entering a single-use recovery code instead. */
  | "recovery"
  /** Fully signed in; the caller redirects. */
  | "done";

export type LoginEvent =
  | { type: "credentials-accepted"; twoFactorRequired: boolean }
  | { type: "use-recovery-code" }
  | { type: "use-authenticator" }
  | { type: "verified" }
  | { type: "restart" };

export interface LoginState {
  step: LoginStep;
}

export const initialLoginState: LoginState = { step: "credentials" };

/** True while the user is answering a 2FA challenge. */
export function isChallenge(state: LoginState): boolean {
  return state.step === "totp" || state.step === "recovery";
}

/**
 * Next state for an event. Unknown transitions return the current state
 * unchanged rather than throwing: the UI must not break on a stray event.
 */
export function loginReducer(state: LoginState, event: LoginEvent): LoginState {
  switch (event.type) {
    case "credentials-accepted":
      // A password alone never completes sign-in for a 2FA account.
      if (state.step !== "credentials") return state;
      return { step: event.twoFactorRequired ? "totp" : "done" };

    case "use-recovery-code":
      return state.step === "totp" ? { step: "recovery" } : state;

    case "use-authenticator":
      return state.step === "recovery" ? { step: "totp" } : state;

    case "verified":
      // Only a challenge can be verified; credentials cannot skip ahead.
      return isChallenge(state) ? { step: "done" } : state;

    case "restart":
      return initialLoginState;

    default:
      return state;
  }
}
