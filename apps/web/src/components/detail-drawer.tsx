// Author: Brijesh Dave <https://github.com/brijeshdave>
// The one detail drawer. A table row is a summary; this is the full record it
// stands for, laid out in labelled sections. Logs and audit both use it, and any
// future "open this row" view should too, so a detail reads the same everywhere.
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/primitives.js";

export function DetailDrawer({
  label,
  header,
  onClose,
  children,
}: {
  /** Accessible name for the dialog. */
  label: string;
  /** The sticky title area (badges, heading). */
  header: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-foreground/20" onClick={onClose} aria-hidden />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-card shadow-xl focus-visible:outline-none"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
          {header}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** A labelled block within a drawer. */
export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-5 py-4 first:border-t-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A label/value pair within a section. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

/** A pretty-printed JSON block for a raw value; renders nothing when empty. */
export function DetailJson({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
