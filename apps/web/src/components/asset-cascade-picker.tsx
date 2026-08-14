// Author: Brijesh Dave <https://github.com/brijeshdave>
// Choosing an asset a level at a time: pick the plant, then the line, then the
// station — and **stop wherever you like**. Whatever level you last chose is the
// answer.
//
// This replaces a single dropdown of every asset in the company. That list was
// long, its entries were long, and with names repeating across plants it needed
// the whole ancestor path on every row just to be unambiguous. Walking down the
// tree removes the problem instead of labelling around it: each step shows only
// what is inside the previous choice, so every list is short and every name in it
// is distinct by construction.
import type { AssetNode } from "@reportly/shared";
import { X } from "lucide-react";
import { useMemo, useState } from "react";

import { Select } from "@/components/ui/form.js";
import { Button } from "@/components/ui/primitives.js";
import { assetOptions, childrenOf } from "@/lib/asset-paths.js";

export interface AssetCascadePickerProps {
  assets: AssetNode[];
  /** Chosen asset ids. Single-select keeps at most one. */
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
}

export function AssetCascadePicker({
  assets,
  value,
  onChange,
  multiple = true,
  disabled,
}: AssetCascadePickerProps) {
  // One entry per level: the id chosen at that depth. Truncated when a level above
  // changes, because a station under Line 3 means nothing once you switch to Line 4.
  const [levels, setLevels] = useState<string[]>([]);

  const active = assets.filter((a) => a.status === "active");
  const paths = useMemo(() => new Map(assetOptions(assets).map((o) => [o.id, o.path])), [assets]);

  /** The choices to show at each level: roots first, then the children of the
   *  previous choice. The last row is the one offering an as-yet-unmade choice. */
  const rows: { parentId: string | null; options: AssetNode[]; chosen: string }[] = [];
  let parentId: string | null = null;
  for (let depth = 0; ; depth += 1) {
    const options = childrenOf(active, parentId);
    if (options.length === 0) break;
    const chosen = levels[depth] ?? "";
    rows.push({ parentId, options, chosen });
    if (!chosen) break;
    parentId = chosen;
  }

  // The deepest level actually chosen — what "stop here and use this" resolves to.
  const current = [...levels].reverse().find(Boolean) ?? "";

  const choose = (depth: number, id: string) => {
    // Everything below becomes meaningless the moment a level above changes.
    const next = levels.slice(0, depth);
    if (id) next[depth] = id;
    setLevels(next);
  };

  const add = () => {
    if (!current) return;
    if (!multiple) {
      onChange([current]);
      return;
    }
    // Silently ignore a repeat rather than erroring: picking the same line twice is
    // a slip, not a mistake worth a message.
    if (!value.includes(current)) onChange([...value, current]);
    setLevels([]);
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full flex-wrap items-end gap-2">
        {rows.map((row, depth) => (
          // Fixed width rather than `flex-1`: sharing the row equally meant every
          // dropdown got narrower as the tree got deeper, so the level you were
          // actually choosing was the hardest to read. At this width they wrap onto
          // a second line instead, which costs vertical space and keeps every name
          // legible.
          <label key={depth} className="flex w-full flex-col gap-1 text-xs sm:w-64">
            <span className="text-muted-foreground">
              {depth === 0 ? "Site or plant" : `Inside ${nameOf(active, row.parentId)}`}
            </span>
            <Select
              value={row.chosen}
              disabled={disabled}
              onChange={(event) => choose(depth, event.target.value)}
            >
              {/* The empty option is what makes "stop here" possible: leaving a
                  level unchosen means the level above it is the answer. */}
              <option value="">{depth === 0 ? "Choose…" : "— all of it —"}</option>
              {row.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                  {option.typeName ? ` (${option.typeName})` : ""}
                </option>
              ))}
            </Select>
          </label>
        ))}

        <Button size="sm" onClick={add} disabled={disabled || !current} type="button">
          {multiple ? "Add" : "Use this"}
        </Button>
      </div>

      {current ? (
        <p className="text-xs text-muted-foreground">
          Will use <span className="font-medium text-foreground">{paths.get(current)}</span>
        </p>
      ) : null}

      {value.length > 0 ? (
        <ul className="flex flex-col gap-1 pt-1">
          {value.map((id) => (
            <li
              key={id}
              className="flex items-start justify-between gap-2 rounded-lg bg-muted px-2 py-1 text-sm"
            >
              {/* Wraps rather than truncates: a deep path is exactly the case where
                  the tail matters, and there is full page width to give it. */}
              <span className="min-w-0 break-words">{paths.get(id) ?? id}</span>
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Remove ${paths.get(id) ?? id}`}
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function nameOf(assets: AssetNode[], id: string | null): string {
  return assets.find((a) => a.id === id)?.name ?? "it";
}
