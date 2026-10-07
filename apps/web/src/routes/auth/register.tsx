// Author: Brijesh Dave <https://github.com/brijeshdave>
// Registration. A new account has no groups, so it has no permissions until an
// administrator assigns some — the confirmation says so rather than dropping the
// user into an empty app wondering what broke.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { createUserSchema, isPasswordValid, suggestUsername } from "@reportly/shared";
import { useRef, useState } from "react";

import { PasswordField } from "@/components/auth/password-field.js";
import { SsoButtons } from "@/components/auth/sso-buttons.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { useForm } from "@/hooks/use-form.js";
import { errorMessage } from "@/lib/error-message.js";
import { authConfigQuery, passwordRulesQuery, queryKeys } from "@/lib/queries.js";
import { signUpWithPassword } from "@/services/auth.js";
import { AuthLayout } from "@/routes/auth/auth-layout.js";

export function RegisterPage() {
  // Suggested from the address until the person edits it themselves.
  const [usernameTouched, setUsernameTouched] = useState(false);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: rules } = useQuery(passwordRulesQuery);
  // A direct visit to /register when sign-up is off goes back to the login screen,
  // matching the API, which would refuse the request anyway.
  const { data: authConfig, isLoading: authConfigLoading } = useQuery(authConfigQuery);

  // The three identity fields are the shared ones, so what this page refuses and
  // what an administrator's New user page refuses are the same rule. The password is
  // judged by the installation's own policy, which is a stored setting rather than
  // part of any schema — see `passwordOk` below.
  const form = useForm({
    schema: createUserSchema.pick({ name: true, email: true, username: true }),
    initial: { name: "", email: "", username: "", password: "" },
    toPayload: (v) => ({
      name: v.name.trim(),
      email: v.email.trim(),
      username: v.username.trim(),
    }),
    submit: async () => {
      const v = valuesRef.current;
      await signUpWithPassword(v.name.trim(), v.email.trim(), v.username.trim(), v.password);
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      await navigate({ to: "/" });
    },
  });
  const { email, username, password } = form.values;
  // `submit` closes over the values as they were when it was built; this is the
  // pair of eyes on the current ones. The password is not in the payload — it is
  // not the schema's to judge — so it has to be read from here.
  const valuesRef = useRef(form.values);
  valuesRef.current = form.values;

  // The server enforces the policy; this only stops an obviously doomed request.
  const passwordOk = rules ? isPasswordValid(rules, password) : password.length > 0;

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

        <form {...form.formProps} className="flex flex-col gap-4">
          {/* Whatever could not be blamed on a field — an address already registered. */}
          {form.formError ? <Alert tone="error">{errorMessage(form.formError)}</Alert> : null}

          <Field label="Full name" required error={form.errorFor("name")}>
            {(props) => (
              <Input
                {...props}
                {...form.register("name")}
                autoComplete="name"
                disabled={form.submitting}
              />
            )}
          </Field>

          <Field label="Email" required error={form.errorFor("email")}>
            {(props) => (
              <Input
                {...props}
                type="email"
                name="email"
                value={email}
                onChange={(event) => {
                  form.set("email", event.target.value);
                  if (!usernameTouched) {
                    form.set(
                      "username",
                      event.target.value.includes("@") ? suggestUsername(event.target.value) : "",
                    );
                  }
                }}
                autoComplete="email"
                disabled={form.submitting}
              />
            )}
          </Field>

          {/* Either identifier signs you in later; pick the one you want to type. */}
          <Field label="Username" required error={form.errorFor("username")}>
            {(props) => (
              <Input
                {...props}
                name="username"
                value={username}
                onChange={(event) => {
                  setUsernameTouched(true);
                  form.set("username", event.target.value);
                }}
                autoComplete="username"
                disabled={form.submitting}
              />
            )}
          </Field>

          <PasswordField
            value={password}
            onChange={(next) => form.set("password", next)}
            rules={rules}
            disabled={form.submitting}
          />

          <Button type="submit" disabled={form.submitting || !passwordOk}>
            {form.submitting ? <Spinner /> : null}
            Create account
          </Button>
        </form>
      </div>
    </AuthLayout>
  );
}
