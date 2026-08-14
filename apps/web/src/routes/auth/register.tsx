// Author: Brijesh Dave <https://github.com/brijeshdave>
// Registration. A new account has no groups, so it has no permissions until an
// administrator assigns some — the confirmation says so rather than dropping the
// user into an empty app wondering what broke.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { isPasswordValid, suggestUsername } from "@reportly/shared";
import { useState, type FormEvent } from "react";

import { PasswordField } from "@/components/auth/password-field.js";
import { SsoButtons } from "@/components/auth/sso-buttons.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";
import { authConfigQuery, passwordRulesQuery, queryKeys } from "@/lib/queries.js";
import { signUpWithPassword } from "@/services/auth.js";
import { AuthLayout } from "@/routes/auth/auth-layout.js";

export function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Suggested from the address until the person edits it themselves.
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: rules } = useQuery(passwordRulesQuery);
  // A direct visit to /register when sign-up is off goes back to the login screen,
  // matching the API, which would refuse the request anyway.
  const { data: authConfig, isLoading: authConfigLoading } = useQuery(authConfigQuery);

  // The server enforces the policy; this only stops an obviously doomed request.
  const passwordOk = rules ? isPasswordValid(rules, password) : password.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUpWithPassword(name.trim(), email.trim(), username.trim(), password);
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      await navigate({ to: "/" });
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  if (!authConfigLoading && authConfig && !authConfig.registrationEnabled) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AuthLayout
      title="Create your account"
      description="You'll get access once an administrator adds you to a group."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SsoButtons />

        <form onSubmit={submit} className="flex flex-col gap-4">
          {error ? <Alert tone="error">{error}</Alert> : null}

          <Field label="Full name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                disabled={busy}
              />
            )}
          </Field>

          <Field label="Email">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (!usernameTouched) {
                    setUsername(
                      event.target.value.includes("@") ? suggestUsername(event.target.value) : "",
                    );
                  }
                }}
                autoComplete="email"
                required
                disabled={busy}
              />
            )}
          </Field>

          {/* Either identifier signs you in later; pick the one you want to type. */}
          <Field label="Username">
            {(props) => (
              <Input
                {...props}
                value={username}
                onChange={(event) => {
                  setUsernameTouched(true);
                  setUsername(event.target.value);
                }}
                autoComplete="username"
                required
                disabled={busy}
              />
            )}
          </Field>

          <PasswordField value={password} onChange={setPassword} rules={rules} disabled={busy} />

          <Button type="submit" disabled={busy || !passwordOk}>
            {busy ? <Spinner /> : null}
            Create account
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
