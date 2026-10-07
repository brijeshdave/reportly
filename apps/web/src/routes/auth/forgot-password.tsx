// Author: Brijesh Dave <https://github.com/brijeshdave>
// Requests a reset link. The confirmation is deliberately identical whether or
// not the address has an account: a different message would let anyone test
// which emails are registered.
import { Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { useForm } from "@/hooks/use-form.js";
import { errorMessage } from "@/lib/error-message.js";
import { requestPasswordReset } from "@/services/auth.js";
import { AuthLayout } from "@/routes/auth/auth-layout.js";

/** The one field this page has. Its own schema: there is no create route to borrow. */
const resetRequestSchema = z.object({
  email: z.string().trim().email("That is not an email address."),
});

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  const form = useForm({
    schema: resetRequestSchema,
    initial: { email: "" },
    toPayload: (v) => ({ email: v.email.trim() }),
    submit: (input) =>
      requestPasswordReset(
        (input as { email: string }).email,
        `${window.location.origin}/reset-password`,
      ),
    onSuccess: () => setSent(true),
  });
  const { email } = form.values;

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
      <form {...form.formProps} className="flex flex-col gap-4">
        {/* Whatever could not be blamed on a field — the mail server refusing, say. */}
        {form.formError ? <Alert tone="error">{errorMessage(form.formError)}</Alert> : null}

        <Field label="Email" required error={form.errorFor("email")}>
          {(props) => (
            <Input
              {...props}
              type="email"
              {...form.register("email")}
              autoComplete="email"
              autoFocus
              disabled={form.submitting}
            />
          )}
        </Field>

        <Button type="submit" disabled={form.submitting}>
          {form.submitting ? <Spinner /> : null}
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}
