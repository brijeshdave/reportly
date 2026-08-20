// Author: Brijesh Dave <https://github.com/brijeshdave>
// Picks a set of entities to assign to a group. The API replaces the whole set on
// save, so this always submits everything ticked — never a delta.
//
// The selection lives here, and survives a trip to another tab because the tab
// panel stays mounted (see components/page-tabs.tsx). It reports its dirtiness
// upward so the tab can be marked: a preserved draft that looks saved is a trap.
import { useEffect, useState, type ReactNode } from "react";

import { Alert, Input, Spinner } from "@/components/ui/form.js";
import { Badge, Button, EmptyState } from "@/components/ui/primitives.js";
import { cn } from "@/lib/cn.js";
import { Inbox } from "lucide-react";

export interface PickerOption {
  id: string;
  label: string;
  /**
   * A second line under the name. Use `meta` instead where the fact is short —
   * a permission count or an email is a suffix, not a paragraph, and a hundred
   * rows each two lines tall is a list nobody can scan.
   */
  description?: string;
  /** Rendered inline after the name, muted: "Journal editor (12)". */
  meta?: string;
  /** A short chip after the name — "System" / "Custom". */
  badge?: string;
  /** Prevents ticking or unticking; used for rows the API would refuse. */
  locked?: boolean;
}

export function AssignmentPicker({
  options,
  selectedIds,
  onSave,
  onDirtyChange,
  disabled,
  emptyMessage = "Nothing to assign yet.",
  footer,
}: {
  options: PickerOption[];
  /** The set currently saved on the server. Dirtiness is measured against it. */
  selectedIds: string[];
  onSave: (ids: string[]) => Promise<unknown>;
  /** Reports whether the ticks differ from what the server holds. */
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  emptyMessage?: string;
  footer?: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = selected.size !== selectedIds.length || selectedIds.some((id) => !selected.has(id));

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const toggle = (id: string) => {
    setSaved(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave([...selected]);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  if (options.length === 0) {
    return <EmptyState icon={Inbox} title="Nothing to assign" description={emptyMessage} />;
  }

  const matches = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  // What is already assigned goes first, under its own heading. With fifty roles to
  // choose from, "what does this group have?" is the question being asked far more
  // often than "what else is there?", and the answer used to be scattered down a
  // list in alphabetical order.
  const chosen = matches.filter((option) => selected.has(option.id));
  const rest = matches.filter((option) => !selected.has(option.id));

  const row = (option: PickerOption) => (
    <li key={option.id}>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 hover:bg-muted/50",
          option.locked && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          type="checkbox"
          checked={selected.has(option.id)}
          disabled={disabled || option.locked || busy}
          onChange={() => toggle(option.id)}
        />
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-medium">{option.label}</span>
          {option.meta ? (
            <span className="text-xs text-muted-foreground">{option.meta}</span>
          ) : null}
          {option.badge ? (
            <Badge tone={option.badge === "System" ? "neutral" : "brand"}>{option.badge}</Badge>
          ) : null}
          {option.description ? (
            <span className="block w-full text-xs text-muted-foreground">{option.description}</span>
          ) : null}
        </span>
      </label>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved && !dirty ? <Alert tone="success">Changes saved.</Alert> : null}

      <div className="flex items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search"
          aria-label="Search options"
        />
        <span className="shrink-0 text-xs text-muted-foreground" role="status">
          {selected.size} of {options.length} selected
        </span>
      </div>

      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
        {chosen.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Selected ({chosen.length})
            </h3>
            <ul className="flex flex-col gap-1">{chosen.map(row)}</ul>
          </div>
        ) : null}

        {rest.length > 0 ? (
          <div className="flex flex-col gap-1">
            {chosen.length > 0 ? (
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Available
              </h3>
            ) : null}
            <ul className="flex flex-col gap-1">{rest.map(row)}</ul>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        {footer ?? <span className="text-xs text-muted-foreground">{selected.size} selected</span>}
        <Button size="sm" onClick={() => void save()} disabled={disabled || busy || !dirty}>
          {busy ? <Spinner /> : null}
          Save changes
        </Button>
      </div>
    </div>
  );
}
