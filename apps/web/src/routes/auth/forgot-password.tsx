// Author: Brijesh Dave <https://github.com/brijeshdave>
// Requests a reset link. The confirmation is deliberately identical whether or
// not the address has an account: a different message would let anyone test
// which emails are registered.
import { Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";
import { requestPasswordReset } from "@/services/auth.js";
import { AuthLayout } from "@/routes/auth/auth-layout.js";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim(), `${window.location.origin}/reset-password`);
      setSent(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <div className="flex flex-col items-center gap-4 text-center">
          <MailCheck className="h-10 w-10 text-success" aria-hidden />
          <p className="text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{email}</span>,
            we've sent it a link to reset the password. The link expires in one hour.
          </p>
          <Link to="/login">
            <Button variant="secondary" size="sm">
              Back to sign in
            </Button>
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="We'll email you a link to choose a new one."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field label="Email">
          {(props) => (
            <Input
              {...props}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
              autoFocus
              disabled={busy}
            />
          )}
        </Field>

        <Button type="submit" disabled={busy}>
          {busy ? <Spinner /> : null}
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
