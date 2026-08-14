// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tracks which tabs of a page hold unsaved work.
//
// Preserving a draft (see TabPanel) is only half the job. A preserved-but-unsaved
// change looks exactly like a saved one, which is its own trap: you tick five
// people, wander off, come back to find them still ticked, and reasonably assume
// they were saved. So a tab holding unsaved work is marked, and closing the
// browser asks first.
//
// Any tab reports its own dirtiness with `useUnsavedChanges(tabId, dirty)`.
import { Alert } from "@/components/ui/form.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface UnsavedChangesValue {
  dirtyTabs: Set<string>;
  setDirty: (tabId: string, dirty: boolean) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());

  const setDirty = useCallback((tabId: string, dirty: boolean) => {
    setDirtyTabs((current) => {
      if (current.has(tabId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  }, []);

  // Reloading or closing the tab would lose the draft, and only the browser can
  // ask first. Navigating within the app preserves it, so no guard is needed there.
  useEffect(() => {
    if (dirtyTabs.size === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyTabs.size]);

  const value = useMemo(() => ({ dirtyTabs, setDirty }), [dirtyTabs, setDirty]);

  return <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>;
}

/** JournalEntry whether this tab holds unsaved work. A no-op outside a provider. */
export function useUnsavedChanges(tabId: string, dirty: boolean): void {
  const context = useContext(UnsavedChangesContext);
  const setDirty = context?.setDirty;

  useEffect(() => {
    if (!setDirty) return;
    setDirty(tabId, dirty);
    // Stop claiming the tab is dirty once it is gone.
    return () => setDirty(tabId, false);
  }, [setDirty, tabId, dirty]);
}

/** The tabs currently holding unsaved work. Empty outside a provider. */
export function useDirtyTabs(): Set<string> {
  return useContext(UnsavedChangesContext)?.dirtyTabs ?? new Set();
}

/**
 * Says plainly that the kept changes are not saved changes. Renders nothing when
 * there is nothing outstanding.
 */
export function UnsavedChangesNotice() {
  const dirtyTabs = useDirtyTabs();
  if (dirtyTabs.size === 0) return null;

  return (
    <Alert tone="warning" className="mt-4">
      You have unsaved changes. They are kept while you move between tabs, but they are only applied
      once you save.
    </Alert>
  );
}
