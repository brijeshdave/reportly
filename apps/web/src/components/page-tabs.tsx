// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tabs for detail pages. The active tab lives in the URL (`?tab=`) so a tab is
// linkable and survives a reload — the brief's "large details = tabbed interfaces".
//
// `TabPanel` is the important part. Rendering only the active tab unmounts the
// others, which silently destroys anything half-typed in them: fill in a name,
// glance at another tab, come back, and it is gone with no warning. A panel
// therefore mounts on its first visit and stays mounted, hidden, afterwards —
// so any form in any tab keeps its state, today and for whatever is added later.
import { useRef, type ReactNode } from "react";

import { useDirtyTabs } from "@/components/unsaved-changes.js";
import { cn } from "@/lib/cn.js";

export interface TabDef {
  /** Matches the `tab` search param. */
  id: string;
  label: string;
}

export function PageTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabDef[];
  active: string;
  /** The page owns navigation, so it can type the search params of its own route. */
  onSelect: (id: string) => void;
}) {
  // Marked so a preserved draft is never mistaken for a saved one.
  const dirty = useDirtyTabs();

  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            // The selected tab is coloured, not merely underlined. It used to
            // differ from its neighbours by a 2px rule and one step of text
            // shade, which several people read as nothing being selected at all
            // — and on a screen where the panel below looks similar whichever
            // tab is open, that is the only thing saying where you are.
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              selected
                ? "border-primary bg-primary/5 font-semibold text-primary"
                : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {dirty.has(tab.id) ? (
              <span
                aria-label="unsaved changes"
                title="Unsaved changes"
                className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warning align-middle"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One tab's content. Mounted on first visit, then kept mounted and hidden — so
 * anything typed into it survives a trip to another tab.
 *
 * `hidden` removes it from the accessibility tree and from layout, so a hidden
 * panel is invisible to screen readers and to `getByRole` alike.
 */
export function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: string;
  children: ReactNode;
}) {
  const visited = useRef(false);
  if (id === active) visited.current = true;

  // An unvisited tab is never mounted, so its queries never fire: opening a page
  // must not fetch the contents of every tab on it.
  if (!visited.current) return null;

  return (
    <div id={`panel-${id}`} role="tabpanel" hidden={id !== active}>
      {children}
    </div>
  );
}
