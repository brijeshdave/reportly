// Author: Brijesh Dave <https://github.com/brijeshdave>
// The frame every unauthenticated screen sits in: brand mark, title, and a card.
// Centralised so the auth screens can't drift apart visually.
import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";

import { DOCS_URL } from "@/lib/docs-url.js";

export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="brand-gradient mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-xl font-bold text-primary-foreground">
            R
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">{children}</div>

        {footer ? <p className="mt-5 text-center text-sm text-muted-foreground">{footer}</p> : null}

        {/* Here rather than on the sign-in page alone: somebody who cannot get in
            is exactly the person who needs the installation and troubleshooting
            pages, and they may be looking at any of these screens when they
            realise it. In a new tab, so a half-typed form is not lost. */}
        <p className="mt-6 text-center">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            Documentation
          </a>
        </p>
      </div>
    </main>
  );
}
