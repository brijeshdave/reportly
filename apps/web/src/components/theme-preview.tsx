// Author: Brijesh Dave <https://github.com/brijeshdave>
// Visual check page for the theme engine: every palette in the current mode, plus
// the base primitives. Moves under /dev/theme (debug-gated) once routing lands.
import { THEME_MODES, THEME_PALETTES } from "@reportly/shared";
import { Building2, FileText, Inbox, Moon, Sun, Users } from "lucide-react";

import { PALETTE_LABELS } from "@/lib/theme.js";
import { useTheme } from "@/components/theme-provider.js";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  GradientTile,
  PageHeader,
  StatCard,
} from "@/components/ui/primitives.js";

export function ThemePreview() {
  const { theme, isDark, setPalette, setMode } = useTheme();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <PageHeader
        title="Reportly design system"
        description="Eight palettes, light and dark. Every colour comes from a token."
        actions={
          <div className="flex items-center gap-2">
            {THEME_MODES.map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={theme.mode === mode ? "primary" : "secondary"}
                onClick={() => setMode(mode)}
              >
                {mode === "light" ? <Sun className="h-4 w-4" /> : null}
                {mode === "dark" ? <Moon className="h-4 w-4" /> : null}
                <span className="capitalize">{mode}</span>
              </Button>
            ))}
          </div>
        }
      />

      <section aria-labelledby="palettes" className="mb-10">
        <h2 id="palettes" className="mb-3 text-sm font-semibold text-muted-foreground">
          Palettes — currently {PALETTE_LABELS[theme.palette]} ({isDark ? "dark" : "light"})
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEME_PALETTES.map((palette) => (
            <button
              key={palette}
              type="button"
              onClick={() => setPalette(palette)}
              data-theme={palette}
              aria-pressed={theme.palette === palette}
              className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-ring"
            >
              <span className="brand-gradient h-9 w-9 shrink-0 rounded-lg" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {PALETTE_LABELS[palette]}
                </span>
                {theme.palette === palette ? (
                  <span className="text-xs text-muted-foreground">Active</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="stats" className="mb-10">
        <h2 id="stats" className="mb-3 text-sm font-semibold text-muted-foreground">
          Stat cards
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Reports" value="1,284" icon={FileText} hint="+12% this month" />
          <StatCard label="Users" value="37" icon={Users} />
          <StatCard label="Companies" value="4" icon={Building2} />
        </div>
      </section>

      <section aria-labelledby="primitives" className="mb-10">
        <h2 id="primitives" className="mb-3 text-sm font-semibold text-muted-foreground">
          Buttons, badges, tiles
        </h2>
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete</Button>
          <Badge tone="brand">Brand</Badge>
          <Badge>Neutral</Badge>
          <Badge tone="success">Active</Badge>
          <Badge tone="warning">Pending</Badge>
          <Badge tone="danger">Failed</Badge>
          <GradientTile icon={FileText} size="sm" label="Reports" />
          <GradientTile icon={Users} label="Users" />
        </Card>
      </section>

      <section aria-labelledby="empty">
        <h2 id="empty" className="mb-3 text-sm font-semibold text-muted-foreground">
          Empty state
        </h2>
        <EmptyState
          icon={Inbox}
          title="No reports yet"
          description="Reports you create will appear here."
          action={<Button size="sm">Create a report</Button>}
        />
      </section>
    </main>
  );
}
