// Author: Brijesh Dave <https://github.com/brijeshdave>
// The one modal in the app: a small confirmation before something destructive or
// irreversible. Everything larger is a page, per the brief's UI rules.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Alert, Spinner } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** Rejections are shown in the dialog; the dialog stays open. */
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear the previous failure only when the dialog opens. Keying this on `busy`
  // too would wipe the error the moment the failed confirm finished.
  useEffect(() => {
    if (!open) return;
    setError(null);
    panelRef.current?.focus();
  }, [open]);

  // Read `busy` through a ref so re-binding the listener can't reset the error.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      // A refused delete (last superadmin, system group) explains itself here.
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/30"
        onClick={busy ? undefined : onClose}
        aria-hidden
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl focus-visible:outline-none"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted-foreground">{description}</div>

        {error ? (
          <Alert tone="error" className="mt-4">
            {error}
          </Alert>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            size="sm"
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
