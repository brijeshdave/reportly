// Author: Brijesh Dave <https://github.com/brijeshdave>
// Two-factor enrolment. The server does not activate 2FA until a first code is
// verified, so a user who closes this before confirming is not locked out.
// The recovery codes are shown exactly once — they cannot be retrieved later.
import { useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button } from "@/components/ui/primitives.js";
import { startTwoFactorEnrolment, verifyTotp, type TwoFactorEnrolment } from "@/services/auth.js";

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
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState<TwoFactorEnrolment | null>(null);
  const [savedCodes, setSavedCodes] = useState(false);

  const start = useMutation({
    mutationFn: () => startTwoFactorEnrolment(password),
    onSuccess: setEnrolment,
  });

  const confirm = useMutation({
    mutationFn: () => verifyTotp(code.trim()),
    onSuccess: onDone,
  });

  // Step 1: prove it's really you before we hand out a new factor.
  if (!enrolment) {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      start.mutate();
    };

    return (
      <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
        {start.error ? <ErrorAlert error={start.error} /> : null}
        <p className="text-sm text-muted-foreground">
          Confirm your password to start setting up two-factor authentication.
        </p>

        <Field label="Current password">
          {(props) => (
            <Input
              {...props}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              disabled={start.isPending}
            />
          )}
        </Field>

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={start.isPending || password === ""}>
            {start.isPending ? <Spinner /> : null}
            Continue
          </Button>
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={start.isPending}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  // Step 2: scan, save the recovery codes, and prove the app works.
  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    confirm.mutate();
  };

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
        <form onSubmit={submitCode} className="flex max-w-sm flex-col gap-4">
          {confirm.error ? <ErrorAlert error={confirm.error} /> : null}

          <Field label="Authentication code">
            {(props) => (
              <Input
                {...props}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                required
                disabled={confirm.isPending}
              />
            )}
          </Field>

          <div className="flex gap-2">
            <Button
              type="submit"
              size="sm"
              // Confirming without the codes saved is how people lock themselves out.
              disabled={confirm.isPending || !savedCodes || code.trim() === ""}
            >
              {confirm.isPending ? <Spinner /> : null}
              Turn on two-factor
            </Button>
            <Button variant="secondary" size="sm" onClick={onCancel} disabled={confirm.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
