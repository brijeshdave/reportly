// Author: Brijesh Dave <https://github.com/brijeshdave>
// Sign-in. Password entry, then the 2FA challenge when the account requires one,
// with a recovery-code path for a lost authenticator. The step machine
// (lib/auth-machine.ts) owns which screen is shown; this file only renders it.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useReducer, useState, type FormEvent } from "react";
import { z } from "zod";

import { PasswordField } from "@/components/auth/password-field.js";
import { SsoButtons } from "@/components/auth/sso-buttons.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { initialLoginState, loginReducer } from "@/lib/auth-machine.js";
import { useForm } from "@/hooks/use-form.js";
import { errorMessage } from "@/lib/error-message.js";
import { authConfigQuery, queryKeys } from "@/lib/queries.js";
import { signInWithPassword, verifyBackupCode, verifyTotp } from "@/services/auth.js";
import { AuthLayout } from "@/routes/auth/auth-layout.js";

export function LoginPage() {
  const [state, dispatch] = useReducer(loginReducer, initialLoginState);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirect } = useSearch({ from: "/login" });

  // Sign-in happened somewhere in the machine; land the user where they meant to go.
  //
  // The refetch is **awaited** before navigating. Firing both at once started the
  // navigation while the session query was still stale, so the guarded route
  // decided there was no session and bounced straight back here — the login screen
  // reappearing for a second or two after a correct two-factor code, which reads as
  // the code having failed. The session exists the whole time; only this page's
  // idea of it was behind.
  useEffect(() => {
    if (state.step !== "done") return;
    let left = false;
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      if (!left) await navigate({ to: redirect ?? "/" });
    })();
    return () => {
      left = true;
    };
  }, [state.step, navigate, queryClient, redirect]);

  /** Runs `action`, showing its failure rather than letting it escape. */
  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (state.step === "totp" || state.step === "recovery") {
    return (
      <TwoFactorStep
        mode={state.step}
        busy={busy}
        error={error}
        onSubmit={(code) =>
          attempt(async () => {
            if (state.step === "totp") await verifyTotp(code);
            else await verifyBackupCode(code);
            dispatch({ type: "verified" });
          })
        }
        onSwitchMode={() =>
          dispatch({
            type: state.step === "totp" ? "use-recovery-code" : "use-authenticator",
          })
        }
        onCancel={() => {
          setError(null);
          dispatch({ type: "restart" });
        }}
      />
    );
  }

  return (
    <CredentialsStep
      busy={busy}
      error={error}
      redirect={redirect}
      onSubmit={(identifier, password) =>
        attempt(async () => {
          const { twoFactorRequired } = await signInWithPassword(identifier, password);
          dispatch({ type: "credentials-accepted", twoFactorRequired });
        })
      }
    />
  );
}

/* ------------------------------- Credentials -------------------------------- */

function CredentialsStep({
  busy,
  error,
  redirect,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  redirect?: string;
  onSubmit: (identifier: string, password: string) => void;
}) {
  // Only offer a register link when public sign-up is actually enabled, so a
  // reader never reaches a dead end.
  const { data: authConfig } = useQuery(authConfigQuery);

  /**
   * Only the empty cases are checked here, and deliberately.
   *
   * A failed sign-in stays a single message above the form, because "wrong
   * password" under the password box would confirm the identifier exists — which is
   * precisely what the generic wording of that message exists to avoid. The parent
   * owns that error and still renders it. What belongs at the field is the part that
   * is about the field: an empty one.
   */
  const form = useForm({
    schema: z.object({
      identifier: z.string().trim().min(1, "Type your email address or username."),
      password: z.string().min(1, "Type your password."),
    }),
    initial: { identifier: "", password: "" },
    submit: async (input) => {
      const v = input as { identifier: string; password: string };
      onSubmit(v.identifier, v.password);
    },
  });
  const { password } = form.values;

  return (
    <AuthLayout
      title="Sign in to Reportly"
      description="Enter your details to continue."
      footer={
        authConfig?.registrationEnabled ? (
          <>
            Don't have an account?{" "}
            <Link to="/register" className="font-medium text-primary hover:underline">
              Create one
            </Link>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <SsoButtons callbackURL={redirect ?? "/"} />

        <form {...form.formProps} className="flex flex-col gap-4">
          {/* The parent's, not the hook's: a refused sign-in has no field to blame. */}
          {error ? <Alert tone="error">{error}</Alert> : null}

          {/* Either identifier signs a person in; the service picks the endpoint
              by whether this looks like an address. `type="text"`, not "email",
              or the browser would refuse a username as malformed. */}
          <Field label="Email or username" required error={form.errorFor("identifier")}>
            {(props) => (
              <Input
                {...props}
                type="text"
                {...form.register("identifier")}
                autoComplete="username"
                disabled={busy}
              />
            )}
          </Field>

          <PasswordField
            value={password}
            onChange={(next) => form.set("password", next)}
            autoComplete="current-password"
            disabled={busy}
            error={form.errorFor("password")}
          />

          {/* Not drawn at all when an administrator handles resets: a link that
              answers 403 is the same fault as saying "check your inbox" and
              sending nothing. */}
          {authConfig?.passwordResetEnabled !== false ? (
            <div className="text-right">
              <Link
                to="/forgot-password"
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Forgot your password?
              </Link>
            </div>
          ) : null}

          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            Sign in
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}

/* -------------------------------- 2FA challenge ------------------------------ */

function TwoFactorStep({
  mode,
  busy,
  error,
  onSubmit,
  onSwitchMode,
  onCancel,
}: {
  mode: "totp" | "recovery";
  busy: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onSwitchMode: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const isTotp = mode === "totp";

  // Switching between code types must not carry the previous code across.
  useEffect(() => setCode(""), [mode]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(code.trim());
  };

  return (
    <AuthLayout
      title="Two-factor authentication"
      description={
        isTotp
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of the recovery codes you saved when you enabled two-factor."
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field label={isTotp ? "Authentication code" : "Recovery code"}>
          {(props) => (
            <Input
              {...props}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              // A recovery code is not numeric, and must not be autofilled as an OTP.
              inputMode={isTotp ? "numeric" : "text"}
              autoComplete={isTotp ? "one-time-code" : "off"}
              placeholder={isTotp ? "123456" : "XXXXX-XXXXX"}
              required
              autoFocus
              disabled={busy}
            />
          )}
        </Field>

        <Button type="submit" disabled={busy}>
          {busy ? <Spinner /> : null}
          Verify
        </Button>

        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={onSwitchMode}
            disabled={busy}
            className="font-medium text-primary hover:underline disabled:opacity-50"
          >
            {isTotp ? "Use a recovery code" : "Use your authenticator app"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Back to sign in
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}
