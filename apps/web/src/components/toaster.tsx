// Author: Brijesh Dave <https://github.com/brijeshdave>
// Brief confirmations that a save worked.
//
// This exists because saving an edit no longer returns you to the index. That
// redirect was a confirmation of sorts — crude, but you knew something had
// happened — and taking it away leaves a form that looks untouched. An inline
// message covers it on a short form and is off-screen on a long one.
//
// Home-grown rather than a dependency: a list of messages and a timer is not worth
// a package, and a toast library brings its own portal, its own animation opinions
// and its own theme.
//
// Everything about it is a setting (`ui.toasts`), because an interruption nobody
// asked for is a matter of taste: whether they appear at all, which corner they
// occupy — the bottom-right collides with floating actions on some screens — and
// how long they stay, since four seconds is an age to one reader and unreadable to
// another.
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn.js";
import { preferencesQuery } from "@/lib/queries.js";

interface Toast {
  id: number;
  message: string;
  tone: "success" | "error";
}

interface ToastApi {
  /** Say that something worked. Silent when the reader has turned toasts off. */
  saved: (message?: string) => void;
  failed: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ saved: () => {}, failed: () => {} });

export const useToast = (): ToastApi => useContext(ToastContext);

const POSITIONS: Record<string, string> = {
  "top-right": "top-4 right-4 items-end",
  "bottom-right": "bottom-4 right-4 items-end",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2 items-center",
};

export function Toaster({ children }: { children: ReactNode }) {
  const { data: preferences } = useQuery(preferencesQuery);
  const settings = preferences?.toasts;
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: Toast["tone"]) => {
      // Off means off: the callers still call, and nothing appears. Keeping the
      // call sites unconditional is what stops "did this screen get a toast?"
      // becoming a thing to remember.
      if (settings && !settings.enabled) return;
      const id = Date.now() + Math.random();
      setToasts((current) => [...current, { id, message, tone }]);

      const seconds = settings?.seconds ?? 4;
      // Zero means it waits to be dismissed — for anybody who wants to read at
      // their own pace, or who is not looking at the screen when it lands.
      if (seconds > 0) window.setTimeout(() => dismiss(id), seconds * 1000);
    },
    [dismiss, settings],
  );

  const api = useMemo<ToastApi>(
    () => ({
      saved: (message = "Saved.") => push(message, "success"),
      failed: (message) => push(message, "error"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 ? (
        <div
          // `polite`, not `assertive`: a save confirmation should not interrupt
          // whatever a screen reader is in the middle of saying.
          aria-live="polite"
          className={cn(
            "pointer-events-none fixed z-[80] flex flex-col gap-2",
            POSITIONS[settings?.position ?? "bottom-right"],
          )}
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-lg",
                toast.tone === "success"
                  ? "border-border bg-card text-foreground"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {toast.tone === "success" ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : null}
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss"
                className="ml-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
