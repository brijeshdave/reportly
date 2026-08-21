// Author: Brijesh Dave <https://github.com/brijeshdave>
// A small preference remembered in this browser: how big the schedule grid is drawn,
// and anything else that is about *this screen* rather than about the account.
//
// Deliberately not a user setting on the server. The same person reads a rota on a
// laptop and on the wall monitor in the plant room, and the size that fits is not the
// same in both — a preference synced across devices would have them fighting it.
//
// Every read and write is guarded. `localStorage` throws outright in some contexts
// (a private window with site data blocked, an embedded webview, a thumbnailer), and
// a preference is never worth breaking a page over: a failure just means the default.
import { useCallback, useState } from "react";

export function useLocalPreference<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: string) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      // Validated rather than cast: the stored string outlives the code that wrote
      // it, so a value retired in a later release must not come back as a class name
      // nothing defines.
      return stored !== null && isValid(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Remembering failed; the choice still applies for this visit.
      }
    },
    [key],
  );

  return [value, update];
}
