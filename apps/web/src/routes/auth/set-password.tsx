// Author: Brijesh Dave <https://github.com/brijeshdave>
// Choosing a password from an emailed token. Reset and accept-invite are the same
// better-auth flow — an invited user simply has no password yet — so they share
// this form and differ only in wording.
import { isPasswordValid } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { PasswordField } from "@/components/auth/password-field.js";
import { Alert, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";
import { passwordRulesQuery } from "@/lib/queries.js";
import { resetPassword } from "@/services/auth.js";
import { AuthLayout } from "@/routes/auth/auth-layout.js";

interface SetPasswordCopy {
  title: string;
  description: string;
  submitLabel: string;
  doneTitle: string;
  doneMessage: string;
}

function SetPasswordForm({ token, copy }: { token: string | undefined; copy: SetPasswordCopy }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const navigate = useNavigate();
  const { data: rules } = useQuery(passwordRulesQuery);

  // A link without a token is a link the user mangled or an expired email.
  if (!token) {
    return (
      <AuthLayout title="This link isn't valid">
        <div className="flex flex-col gap-4">
          <Alert tone="error">
            The link is missing its token. It may have been broken by your email client, or it may
            have already been used.
          </Alert>
          <Link to="/forgot-password">
            <Button variant="secondary" className="w-full">
              Request a new link
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title={copy.doneTitle}>
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-success" aria-hidden />
          <p className="text-sm text-muted-foreground">{copy.doneMessage}</p>
          <Button size="sm" onClick={() => void navigate({ to: "/login" })}>
            Continue to sign in
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = rules ? isPasswordValid(rules, password) : password.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={copy.title} description={copy.description}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <PasswordField
          label="New password"
          value={password}
          onChange={setPassword}
          rules={rules}
          disabled={busy}
        />

        <PasswordField
          label="Confirm password"
          value={confirm}
          onChange={setConfirm}
          error={mismatch ? "Passwords don't match" : null}
          disabled={busy}
        />

        <Button type="submit" disabled={busy || !valid || mismatch || confirm.length === 0}>
          {busy ? <Spinner /> : null}
          {copy.submitLabel}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage({ token }: { token?: string }) {
  return (
    <SetPasswordForm
      token={token}
      copy={{
        title: "Choose a new password",
        description: "Pick something you haven't used here before.",
        submitLabel: "Reset password",
        doneTitle: "Password updated",
        doneMessage: "Your password has been changed. Sign in with it to continue.",
      }}
    />
  );
}

export function AcceptInvitePage({ token }: { token?: string }) {
  return (
    <SetPasswordForm
      token={token}
      copy={{
        title: "Welcome to Reportly",
        description: "Set a password to finish setting up your account.",
        submitLabel: "Set password",
        doneTitle: "Account ready",
        doneMessage:
          "Your password is set. An administrator will add you to a group, which is what grants access.",
      }}
    />
  );
}
