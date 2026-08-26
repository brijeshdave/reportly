// Author: Brijesh Dave <https://github.com/brijeshdave>
// One open panel at a time, across a whole tab.
//
// The cartridge setup rows each carry two or three inline editors — Fits, Edit,
// Rates, Uses — and every one of them owned a private `useState(false)`. Nothing
// knew about anything else, so opening one never closed another: click through a
// few rows and the page becomes a stack of half-finished forms with the row you
// wanted somewhere below the fold. Reported as "it keeps previous all open options
// opened so ui become very complicated".
//
// A panel is identified by the row it belongs to *and* which editor it is, so
// switching editors within one row closes the first as well — the two are
// alternative views of the same thing, not two things to hold open at once.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface PanelState {
  /** Whether this exact panel is the open one. */
  isOpen: (key: string) => boolean;
  /** Open this panel, closing whatever was open. Opening the open one closes it. */
  toggle: (key: string) => void;
  /** Close whatever is open — after a save, or a cancel. */
  close: () => void;
}

const Context = createContext<PanelState | null>(null);

export function ExclusivePanels({ children }: { children: ReactNode }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const value = useMemo<PanelState>(
    () => ({
      isOpen: (key) => openKey === key,
      toggle: (key) => setOpenKey((now) => (now === key ? null : key)),
      close: () => setOpenKey(null),
    }),
    [openKey],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * One panel's slice of that state.
 *
 * Falls back to private state when no provider is above it, so an editor dropped
 * somewhere else still works rather than throwing — but inside a tab, the shared
 * one wins and the tab behaves as a single accordion.
 */
export function useExclusivePanel(key: string): {
  open: boolean;
  setOpen: (open: boolean) => void;
} {
  const shared = useContext(Context);
  const [privateOpen, setPrivateOpen] = useState(false);

  const setOpen = useCallback(
    (next: boolean) => {
      if (!shared) {
        setPrivateOpen(next);
        return;
      }
      if (next) {
        if (!shared.isOpen(key)) shared.toggle(key);
      } else if (shared.isOpen(key)) {
        shared.close();
      }
    },
    [shared, key],
  );

  return { open: shared ? shared.isOpen(key) : privateOpen, setOpen };
}
