// Author: Brijesh Dave <https://github.com/brijeshdave>
// Follow a value, but only after it stops changing.
//
// For anything that fires a request per keystroke. 250ms is about a typing pause —
// long enough that "banti" is one search rather than five, short enough that the
// list feels like it is keeping up.
import { useEffect, useState } from "react";

export function useDebounced<T>(value: T, delayMs = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
