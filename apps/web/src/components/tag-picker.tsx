// Author: Brijesh Dave <https://github.com/brijeshdave>
// Pick tags for a record from the ones its department already has.
//
// **Tags are not created here.** They are a shared vocabulary — the whole reason
// to have them rather than free text is that everybody labelling the same problem
// picks the same word. Letting anyone add one mid-form produces "leak", "Leak",
// "leaking" and "water leak" within a week, and then nothing groups. New tags are
// deliberately an administrative act, under JournalEntry setup → Tags.
//
// The list **opens on the whole vocabulary** rather than waiting for a search.
// It used to show nothing until you typed, on the reasoning that a department
// accumulates dozens and a wall of chips is noise — but that reasoning only holds
// for somebody who already knows what the tags are called. Everybody else was
// asked to guess a word before being shown any, which is the one thing a shared
// vocabulary exists to avoid. So: a scrollable dropdown, each entry in its own
// colour, and typing narrows it.
import { type TagRow } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Search, Tag as TagIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { TagChip } from "@/components/tag-chip.js";
import { Spinner } from "@/components/ui/form.js";
import { useAnchoredPopover } from "@/lib/use-anchored-popover.js";
import { fetchTags } from "@/services/vocabulary.js";

export interface TagPickerProps {
  departmentId: string | null | undefined;
  value: string[];
  onChange: (tagIds: string[]) => void;
  disabled?: boolean;
}

const normalise = (name: string): string => name.trim().toLowerCase();

export function TagPicker({ departmentId, value, onChange, disabled }: TagPickerProps) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const coords = useAnchoredPopover(open, anchorRef);

  const tags = useQuery({
    queryKey: ["vocabulary", "tags", departmentId],
    queryFn: () => fetchTags(departmentId ?? undefined),
    enabled: Boolean(departmentId),
  });

  const all = useMemo(() => tags.data ?? [], [tags.data]);
  // Retired tags stay on records already carrying them but are refused on new work,
  // so offering one here would be a picker that produces a validation error.
  const available = useMemo(() => all.filter((t) => t.status === "active"), [all]);
  const byId = useMemo(() => new Map(all.map((t) => [t.id, t])), [all]);

  // Anything already chosen is shown above as a chip, so repeating it in the list
  // would only invite a click that does nothing.
  const matches = useMemo(() => {
    const needle = normalise(search);
    return available.filter(
      (t) => !value.includes(t.id) && (needle === "" || normalise(t.name).includes(needle)),
    );
  }, [available, search, value]);

  if (!departmentId) {
    return (
      <p className="text-xs text-muted-foreground">Pick a department first — tags belong to one.</p>
    );
  }
  if (tags.isLoading) return <Spinner />;

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  const add = (id: string) => {
    onChange([...value, id]);
    // The list stays open and the search resets: picking two or three tags is the
    // normal case, and closing after each one makes that three round trips.
    setSearch("");
  };

  return (
    <div className="flex w-full flex-col gap-2">
      {/* What is chosen reads as chosen — solid chips with a remove control, rather
          than the whole vocabulary shown at once with the picked ones ringed. */}
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const tag = byId.get(id);
            if (!tag) return null;
            return (
              <TagChip
                key={id}
                name={tag.name}
                color={tag.color}
                size="sm"
                onRemove={disabled ? undefined : () => onChange(value.filter((t) => t !== id))}
              />
            );
          })}
        </div>
      ) : null}

      {available.length === 0 ? (
        // Two different situations, and telling them apart matters: "none exist" is
        // an administrator's job to fix, "all retired" is a deliberate state
        // somebody chose and may want to undo.
        <p className="text-xs text-muted-foreground">
          {all.length === 0
            ? "This department has no tags yet — an administrator sets them up under Journal setup."
            : "Every tag in this department has been retired, so there is none to pick."}
        </p>
      ) : (
        <div ref={anchorRef} className="w-full">
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-border bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <TagIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-muted-foreground">
              {value.length > 0 ? "Add another tag…" : "Choose tags…"}
            </span>
          </button>
        </div>
      )}

      {open && coords
        ? createPortal(
            <>
              {/* A catcher so a click anywhere else closes the popover. */}
              <div className="fixed inset-0 z-[60]" aria-hidden onClick={close} />
              <div
                role="listbox"
                aria-label="Tags"
                onKeyDown={(event) => {
                  if (event.key === "Escape") close();
                }}
                style={{
                  position: "fixed",
                  left: coords.left,
                  width: coords.width,
                  top: coords.top,
                  bottom: coords.bottom,
                  maxHeight: coords.maxHeight,
                }}
                className="z-[61] flex flex-col overflow-hidden rounded-xl border border-border bg-card p-1 shadow-lg"
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-1">
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <input
                    autoFocus
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search tags…"
                    aria-label="Search tags"
                    className="h-7 w-full bg-transparent text-sm focus-visible:outline-none"
                  />
                </div>

                {/* Scrolls rather than truncating: a department with forty tags should
                    be browsable, and a cut-off list hides exactly the ones somebody
                    could not name in the first place. */}
                <div className="flex-1 overflow-y-auto p-1">
                  {matches.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      {normalise(search) === ""
                        ? "Every tag in this department is already on this entry."
                        : `No tag matches “${search.trim()}”. Tags are set up under JournalEntry setup → Tags.`}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {matches.map((tag: TagRow) => (
                        <button
                          key={tag.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          disabled={disabled}
                          onClick={() => add(tag.id)}
                          aria-label={tag.name}
                          className="rounded-full transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <TagChip name={tag.name} color={tag.color} size="sm" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
