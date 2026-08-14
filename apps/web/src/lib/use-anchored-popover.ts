// Author: Brijesh Dave <https://github.com/brijeshdave>
// Position a portalled popover against the field that opened it.
//
// Popovers here are rendered in a portal with fixed positioning rather than as an
// absolute child, so a scrollable, clipping container — the filter sidebar, a
// dialog body — cannot cut them off. That buys correctness and costs placement:
// a portalled element knows nothing about where its anchor is, so it has to be
// measured against the viewport and re-measured whenever anything moves.
//
// Flips above the anchor when there is not enough room below, and caps its height
// to the space actually available, so the options are always readable and
// reachable rather than running off the bottom of the window.
import { useLayoutEffect, useState, type RefObject } from "react";

export interface PopoverCoords {
  left: number;
  width: number;
  /** Set when dropping down; `bottom` is set instead when flipped up. */
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/** Room below the anchor under which it is worth flipping up instead. */
const COMFORTABLE = 220;

export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
): PopoverCoords | null {
  const [coords, setCoords] = useState<PopoverCoords | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const margin = 8;
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const flipUp = below < COMFORTABLE && above > below;
      setCoords({
        left: rect.left,
        width: rect.width,
        top: flipUp ? undefined : rect.bottom + 4,
        bottom: flipUp ? window.innerHeight - rect.top + 4 : undefined,
        maxHeight: Math.max(160, Math.min(340, flipUp ? above : below)),
      });
    };
    place();
    // Capture phase, so a scroll inside a container (which does not bubble) is
    // caught and the popover tracks its field rather than drifting away from it.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef]);

  return coords;
}
