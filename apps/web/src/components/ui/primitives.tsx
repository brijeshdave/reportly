// Author: Brijesh Dave <https://github.com/brijeshdave>
// Base UI primitives shared by every page. Colour comes only from design tokens;
// gradients are confined to icon tiles, primary buttons, and the active nav pill.
import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn.js";

/* ---------------------------------- Button --------------------------------- */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "brand-gradient text-primary-foreground shadow-sm hover:opacity-90",
        secondary: "bg-card text-foreground border border-border hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-10 px-4",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

/* -------------------------------- Badge (pill) ------------------------------ */

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        brand: "brand-gradient text-primary-foreground",
        success: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
        danger: "bg-destructive/10 text-destructive",
        // A bordered pill that reads clearly against any surface in both themes —
        // for a label that should be distinct but not coloured.
        outline: "border border-border bg-transparent text-foreground",
        // A soft, filled blue — a calm, clearly-visible accent in both themes, for a
        // label that is informational rather than a warning or a success (a work log).
        info: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ------------------------------ Gradient tile ------------------------------- */

const tileSizes = {
  sm: "h-9 w-9 rounded-lg",
  md: "h-11 w-11 rounded-xl",
  lg: "h-16 w-16 rounded-2xl",
};

export function GradientTile({
  icon: Icon,
  size = "md",
  className,
  label,
}: {
  icon: LucideIcon;
  size?: keyof typeof tileSizes;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "brand-gradient inline-flex items-center justify-center text-primary-foreground shadow-sm",
        tileSizes[size],
        className,
      )}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Icon className={size === "lg" ? "h-7 w-7" : "h-5 w-5"} strokeWidth={2} />
    </span>
  );
}

/* ----------------------------------- Card ----------------------------------- */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

export function StatCard({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  hint?: string;
}) {
  return (
    <Card className="flex items-center gap-4 p-4">
      <GradientTile icon={icon} />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="truncate text-2xl font-semibold tracking-tight">{value}</p>
        {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </Card>
  );
}

/* -------------------------------- Page header -------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  /** A node, not just text: a page about a person leads with their face. */
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/* -------------------------------- Empty state -------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <GradientTile icon={icon} size="lg" />
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}
