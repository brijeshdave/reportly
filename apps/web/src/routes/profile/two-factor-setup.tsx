// Author: Brijesh Dave <https://github.com/brijeshdave>
// Two-factor enrolment. The server does not activate 2FA until a first code is
// verified, so a user who closes this before confirming is not locked out.
// The recovery codes are shown exactly once — they cannot be retrieved later.
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useForm } from "@/hooks/use-form.js";
import { Button } from "@/components/ui/primitives.js";
import { startTwoFactorEnrolment, verifyTotp, type TwoFactorEnrolment } from "@/services/auth.js";

/**
 * These two steps talk to the auth endpoints rather than a Reportly route, so there
 * is no route schema to share. Both exist to give the empty case a message of its
 * own — the refusals that matter here (a wrong password, a code that does not
 * match) come from the server, and both are about the one field on the screen.
 */
const passwordStepSchema = z.object({
  password: z.string().min(1, "Type your current password."),
});

const codeStepSchema = z.object({
  code: z.string().trim().min(1, "Type the six-digit code from your app."),
});

/** The shared secret, for someone typing it into their app by hand. */
function secretFrom(totpURI: string): string {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function QrImage({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 220 })
      .then((url) => !cancelled && setDataUrl(url))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [value]);

  // The secret below is always shown, so a failed QR is inconvenient, not fatal.
  if (failed) return <Alert tone="info">Enter the setup key below into your app instead.</Alert>;
  if (!dataUrl) return <Spinner />;

  return (
    <img
      src={dataUrl}
      alt="QR code for setting up two-factor authentication"
      className="rounded-xl border border-border bg-white p-2"
      width={220}
      height={220}
    />
  );
}

export function TwoFactorSetup({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);

  const start = useForm({
    schema: passwordStepSchema,
    initial: { password: "" },
    submit: (input) => startTwoFactorEnrolment((input as { password: string }).password),
    onSuccess: (result) => setEnrolment(result as TwoFactorEnrolment),
  });

  const confirm = useForm({
    schema: codeStepSchema,
    initial: { code: "" },
    submit: (input) => verifyTotp((input as { code: string }).code),
    onSuccess: onDone,
  });

  // Step 1: prove it's really you before we hand out a new factor.
  if (!enrolment) {
    return (
      <form {...start.formProps} className="flex max-w-sm flex-col gap-4">
        {/* Whatever was not about the password itself. */}
        {start.formError ? <ErrorAlert error={start.formError} /> : null}
        <p className="text-sm text-muted-foreground">
          Confirm your password to start setting up two-factor authentication.
        </p>

        <Field label="Current password" required error={start.errorFor("password")}>
          {(props) => (
            <Input
              {...props}
              type="password"
              {...start.register("password")}
              autoComplete="current-password"
              disabled={start.submitting}
            />
          )}
        </Field>

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={start.submitting}>
            {start.submitting ? <Spinner /> : null}
            Continue
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={onCancel}
            disabled={start.submitting}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  // Step 2: scan, save the recovery codes, and prove the app works.
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">1. Scan this with your authenticator app</h3>
        <QrImage value={enrolment.totpURI} />
        <div>
          <p className="text-xs text-muted-foreground">Or enter this setup key by hand:</p>
          <code className="mt-1 block break-all rounded-lg bg-muted px-2 py-1 text-xs">
            {secretFrom(enrolment.totpURI)}
          </code>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">2. Save your recovery codes</h3>
        <Alert tone="info">
          These are shown once and cannot be retrieved later. Each works a single time, if you lose
          your authenticator.
        </Alert>
        <ul className="grid grid-cols-2 gap-2">
          {enrolment.backupCodes.map((backupCode) => (
            <li key={backupCode}>
              <code className="block rounded-lg bg-muted px-2 py-1 text-center text-xs">
                {backupCode}
              </code>
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={savedCodes}
            onChange={(event) => setSavedCodes(event.target.checked)}
          />
          I have saved these codes somewhere safe
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">3. Confirm a code from the app</h3>
        <form {...confirm.formProps} className="flex max-w-sm flex-col gap-4">
          {/* Whatever was not about the code itself. */}
          {confirm.formError ? <ErrorAlert error={confirm.formError} /> : null}

          <Field label="Authentication code" required error={confirm.errorFor("code")}>
            {(props) => (
              <Input
                {...props}
                {...confirm.register("code")}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                disabled={confirm.submitting}
              />
            )}
          </Field>

          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              // Still disabled on the codes, which is the one guard worth keeping: its
              // cause is the ticked box directly above, so the button is not a mystery.
              // An empty code is no longer a reason — that now says so under the field.
              disabled={confirm.submitting || !savedCodes}
            >
              {confirm.submitting ? <Spinner /> : null}
              Turn on two-factor
            </Button>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={onCancel}
              disabled={confirm.submitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
