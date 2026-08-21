// Author: Brijesh Dave <https://github.com/brijeshdave>
// The month roster as an even, readable grid: members down the side, days across the
// top, a short coloured code in each cell. A scheduler paints with a multi-day brush —
// click a day, Ctrl/Cmd-click to add separate days, Shift-click to select a run, or
// "Add all…" a weekday — then a toolbar sets them together. Cells with a pending shift
// change are ringed amber, with the detail on hover; requesting and approving a change
// live on the Shift-change page, not here. The Scheduled/Actual toggle reads baseline
// vs live.
import {
  ENTRY_STATE_CODES,
  ENTRY_STATE_LABELS,
  formatMinutesOfDay,
  type EntryState,
  type ScheduleEntry,
  type ScheduleGrid,
  type ScheduleStateColors,
  type Shift,
} from "@reportly/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { Avatar } from "@/components/avatar.js";
import { MultiSelect } from "@/components/multi-select.js";
import { cn } from "@/lib/cn.js";
import { cellClasses } from "@/routes/shifts/shift-colors.js";
import { bulkAssign } from "@/services/shifts.js";

export type ScheduleView = "actual" | "scheduled" | "changes";

/**
 * How large the grid is drawn.
 *
 * A month is 31 columns however you set it, so the size that fits is a trade between
 * legibility and how many people you see without scrolling. That is a judgement about
 * one department on one screen, not something this file can decide — so it is a
 * control on the page, remembered per person, rather than a constant.
 *
 * `compact` is exactly the density this grid had before the type grew, so nobody who
 * was happy with it loses anything.
 */
export const GRID_DENSITIES = ["compact", "comfortable", "large"] as const;
export type GridDensity = (typeof GRID_DENSITIES)[number];

export const DENSITY_LABELS: Record<GridDensity, string> = {
  compact: "Compact",
  comfortable: "Comfortable",
  large: "Large",
};

const DENSITY: Record<GridDensity, { code: string; row: string; head: string; name: string }> = {
  compact: {
    code: "text-[11px] leading-4",
    row: "min-h-[1.7rem]",
    head: "text-[11px]",
    name: "text-[11px]",
  },
  comfortable: {
    code: "text-[13px] leading-5",
    row: "min-h-[2.1rem]",
    head: "text-xs",
    name: "text-[13px]",
  },
  large: {
    code: "text-[15px] leading-6",
    row: "min-h-[2.5rem]",
    head: "text-sm",
    name: "text-sm",
  },
};

/** Which days of one person are currently painted, and the anchor a Shift-range grows from. */
interface Selection {
  userId: string;
  anchor: string;
  dates: string[];
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}
/** Day of week, 0 = Sunday … 6 = Saturday. Parsed as local midnight so it never slips. */
function dow(date: string): number {
  return new Date(`${date}T00:00:00`).getDay();
}
function isWeekend(date: string): boolean {
  const d = dow(date);
  return d === 0 || d === 6;
}

/** What a cell shows in the chosen view — the live assignment, or the frozen baseline. */
function cellView(
  entry: ScheduleEntry,
  view: ScheduleView,
): { shiftId: string | null; state: EntryState } {
  if (view === "scheduled") {
    return { shiftId: entry.plannedShiftId, state: entry.plannedState ?? "off" };
  }
  return { shiftId: entry.shiftId, state: entry.state };
}

/** One assignment as a compact, even chip: a shift's code and colour, or W/O / L / PH. */
/**
 * The full site names for a cell's tooltip — the initials shown in the cell are
 * unambiguous only to somebody who already knows the sites.
 */
function siteTitle(
  cells: { locationIds: string[] }[],
  options: { id: string; name: string }[],
): string | undefined {
  const ids = [...new Set(cells.flatMap((c) => c.locationIds))];
  if (ids.length === 0) return undefined;
  const names = ids.map((id) => options.find((o) => o.id === id)?.name ?? "Unknown site");
  return names.length === 1 ? `At ${names[0]}` : `At ${names.join(" and ")}`;
}

/** A site's initials, for a cell too narrow to hold its name. */
function siteInitials(options: { id: string; name: string }[], id: string): string {
  const name = options.find((o) => o.id === id)?.name ?? "";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  return initials.slice(0, 3) || "?";
}

/**
 * One day, drawn as a solid block of its colour.
 *
 * `whitespace-nowrap` is load-bearing, not tidiness: without it a narrow column breaks
 * "W/O" at the slash and stacks "W/" above "O", which is what a month of days off
 * looked like on a laptop.
 */
function Chip({
  shiftId,
  state,
  shifts,
  stateColors,
  density,
}: {
  shiftId: string | null;
  state: EntryState;
  shifts: Shift[];
  stateColors: ScheduleStateColors;
  density: GridDensity;
}) {
  const size = DENSITY[density];

  if (state !== "working") {
    return (
      <span
        className={cn(
          "flex h-full w-full items-center justify-center whitespace-nowrap font-semibold",
          size.code,
          cellClasses(stateColors[state]),
        )}
        title={ENTRY_STATE_LABELS[state]}
      >
        {ENTRY_STATE_CODES[state]}
      </span>
    );
  }
  const shift = shifts.find((s) => s.id === shiftId);
  if (!shift) return null;
  return (
    <span
      className={cn(
        "flex h-full w-full items-center justify-center whitespace-nowrap font-bold",
        size.code,
        cellClasses(shift.color),
      )}
      title={`${shift.name} · ${formatMinutesOfDay(shift.startMinute)}–${formatMinutesOfDay(shift.endMinute)}`}
    >
      {shift.code}
    </span>
  );
}

export function ScheduleGridView({
  grid,
  view,
  canManage,
  onChanged,
  density,
}: {
  grid: ScheduleGrid;
  view: ScheduleView;
  canManage: boolean;
  onChanged: () => void;
  /** Chosen on the page above, and remembered there. */
  density: GridDensity;
}) {
  const size = DENSITY[density];
  const scheduleId = grid.schedule?.id ?? null;
  const editable = canManage && view === "actual" && scheduleId !== null;
  const published = grid.schedule?.status === "published";

  // A cell is "changed" when its live assignment differs from the frozen baseline —
  // i.e. an approved swap (or a post-publish edit) moved it away from the plan.
  const isChanged = (e: ScheduleEntry) =>
    published &&
    e.plannedState !== null &&
    (e.shiftId !== e.plannedShiftId || e.state !== e.plannedState);
  const labelOf = (shiftId: string | null, state: EntryState) =>
    state === "working"
      ? (grid.shifts.find((s) => s.id === shiftId)?.name ?? "—")
      : ENTRY_STATE_LABELS[state];
  const changeDetail = (e: ScheduleEntry) =>
    `Changed from ${labelOf(e.plannedShiftId, e.plannedState ?? "off")} to ${labelOf(e.shiftId, e.state)}`;

  const [selection, setSelection] = useState<Selection | null>(null);

  // date -> shift codes nobody covers that day, and the set of (date|user) gaps.
  const uncoveredByDate = new Map<string, string[]>();
  for (const u of grid.coverage.uncovered) {
    const code = grid.shifts.find((s) => s.id === u.shiftId)?.code ?? "?";
    uncoveredByDate.set(u.date, [...(uncoveredByDate.get(u.date) ?? []), code]);
  }
  const gapSet = new Set(grid.coverage.gaps.map((g) => `${g.date}|${g.userId}`));

  // entryId -> the hover detail of a pending change touching that cell.
  const pendingByEntry = new Map<string, string>();
  for (const p of grid.pendingChanges) {
    const detail =
      `Change requested by ${p.requesterName}` +
      (p.counterpartName ? ` — swap with ${p.counterpartName}` : " — awaiting a swap partner") +
      (p.note ? ` · “${p.note}”` : "");
    pendingByEntry.set(p.requesterEntryId, detail);
    if (p.counterpartEntryId) pendingByEntry.set(p.counterpartEntryId, detail);
  }

  const entriesFor = (userId: string, date: string) =>
    grid.entries.filter((e) => e.userId === userId && e.date === date);

  const selectCell = (userId: string, date: string, e: MouseEvent) => {
    const multi = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    setSelection((prev) => {
      if (!prev || prev.userId !== userId) return { userId, anchor: date, dates: [date] };
      if (range) {
        const i1 = grid.days.indexOf(prev.anchor);
        const i2 = grid.days.indexOf(date);
        const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
        return { userId, anchor: prev.anchor, dates: grid.days.slice(lo, hi + 1) };
      }
      if (multi) {
        const has = prev.dates.includes(date);
        const dates = has ? prev.dates.filter((d) => d !== date) : [...prev.dates, date];
        return dates.length ? { userId, anchor: date, dates } : null;
      }
      return { userId, anchor: date, dates: [date] };
    });
  };

  const isSelected = (userId: string, date: string) =>
    selection?.userId === userId && selection.dates.includes(date);

  // Add every matching day of the month to the current selection — "all Sundays", the
  // weekends, and so on — so a repeating pattern is one move, not thirty clicks.
  const addWeekday = (match: "weekend" | number) => {
    const matches = grid.days.filter((d) =>
      match === "weekend" ? isWeekend(d) : dow(d) === match,
    );
    setSelection((prev) =>
      prev ? { ...prev, dates: Array.from(new Set([...prev.dates, ...matches])) } : prev,
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {editable && selection && scheduleId ? (
        <SelectionToolbar
          scheduleId={scheduleId}
          selection={selection}
          memberName={grid.members.find((m) => m.userId === selection.userId)?.name ?? ""}
          shifts={grid.shifts}
          stateColors={grid.stateColors}
          siteOptions={grid.locationOptions}
          onAddWeekday={addWeekday}
          onDone={() => setSelection(null)}
          onChanged={onChanged}
        />
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        {/* Fixed layout with an explicit width per day: the boxes are the calendar,
            and boxes of different widths because one holds "W/O" and the next holds
            "A" read as a broken table rather than a rota. */}
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr>
              <th
                className={cn(
                  // 7rem, not 9: every millimetre here is a millimetre the 31 day
                  // columns do not get, and a truncated name with the full one on
                  // hover costs less than a month that does not fit across.
                  "sticky left-0 z-10 w-[7rem] border-b border-r border-border bg-card px-2 py-2 text-left font-semibold",
                  size.head,
                )}
              >
                {grid.members.length} {grid.members.length === 1 ? "person" : "people"}
              </th>
              {grid.days.map((date) => {
                const uncovered = uncoveredByDate.get(date);
                const d = dow(date);
                return (
                  <th
                    key={date}
                    style={{ width: "1.9rem" }}
                    title={uncovered ? `Uncovered: ${uncovered.join(", ")}` : undefined}
                    className={cn(
                      "border-b border-border px-0 py-1 text-center font-medium",
                      size.head,
                      d === 0
                        ? "bg-rose-50 dark:bg-rose-950/30"
                        : isWeekend(date)
                          ? "bg-muted/60"
                          : "bg-card",
                    )}
                  >
                    {/* Sunday is tinted rose and Saturday plain, so the two weekend days
                        never read as the same "S". */}
                    <div
                      className={
                        d === 0
                          ? "font-semibold text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground"
                      }
                    >
                      {WEEKDAY_LABELS[d]}
                    </div>
                    <div className="flex items-center justify-center gap-0.5 tabular-nums">
                      {dayNumber(date)}
                      {uncovered ? (
                        <span className="inline-block h-1 w-1 rounded-full bg-destructive" />
                      ) : null}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {grid.members.map((member) => (
              <tr key={member.userId}>
                <th className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-1.5 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <Avatar
                      userId={member.userId}
                      name={member.name}
                      version={member.avatarVersion}
                      size="sm"
                    />
                    <span className={cn("truncate font-medium", size.name)} title={member.name}>
                      {member.name}
                    </span>
                  </span>
                </th>
                {grid.days.map((date) => {
                  const cells = entriesFor(member.userId, date);
                  const selected = isSelected(member.userId, date);
                  const isGap = gapSet.has(`${date}|${member.userId}`);
                  const pending = cells.map((c) => pendingByEntry.get(c.id)).find(Boolean) ?? null;
                  const changedCells = cells.filter(isChanged);
                  const changed = changedCells.length > 0;
                  const changeTitle = changed ? changedCells.map(changeDetail).join("; ") : null;
                  // In the changes view, a cell with nothing changed is dimmed so the moves stand out.
                  const dim = view === "changes" && !changed;
                  return (
                    <td
                      key={date}
                      style={{ width: "1.9rem" }}
                      className={cn(
                        "relative h-px border-b border-l border-border p-0 text-center align-middle",
                        isWeekend(date) ? "bg-muted/30" : "",
                        selected
                          ? "bg-primary/15 ring-1 ring-inset ring-primary"
                          : pending
                            ? "ring-1 ring-inset ring-amber-400"
                            : changed && view !== "scheduled"
                              ? "ring-1 ring-inset ring-indigo-400"
                              : "",
                      )}
                    >
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={(e) => editable && selectCell(member.userId, date, e)}
                        // Every cell in a roster looked identical to a screen
                        // reader: an unnamed button whose only content is a
                        // one-or-two letter shift code, with the person in a row
                        // header and the date in a column header it never
                        // announces together. The name says whose day it is.
                        aria-label={`${member.name}, ${date}`}
                        title={
                          pending ??
                          changeTitle ??
                          siteTitle(cells, grid.locationOptions) ??
                          (editable && isGap ? "No shift assigned (gap)" : undefined)
                        }
                        className={cn(
                          "flex w-full items-center justify-center",
                          size.row,
                          editable ? "cursor-pointer hover:bg-muted/70" : "cursor-default",
                          dim ? "opacity-30" : "",
                        )}
                      >
                        {pending ? (
                          <span
                            className="absolute left-0 top-0 h-1.5 w-1.5 rounded-br bg-amber-400"
                            aria-hidden
                          />
                        ) : changed && view !== "scheduled" ? (
                          <span
                            className="absolute left-0 top-0 h-1.5 w-1.5 rounded-br bg-indigo-400"
                            aria-hidden
                          />
                        ) : null}
                        {cells.length === 0 ? (
                          <span
                            className={cn(
                              size.code,
                              isGap && editable ? "text-border" : "text-transparent",
                            )}
                          >
                            ·
                          </span>
                        ) : view === "changes" ? (
                          <span className="flex flex-col items-center gap-0.5">
                            {cells.map((entry) =>
                              isChanged(entry) ? (
                                <span key={entry.id} className="flex flex-col items-center gap-0.5">
                                  <span className="line-through opacity-50">
                                    <Chip
                                      shiftId={entry.plannedShiftId}
                                      state={entry.plannedState ?? "off"}
                                      shifts={grid.shifts}
                                      stateColors={grid.stateColors}
                                      density={density}
                                    />
                                  </span>
                                  <Chip
                                    shiftId={entry.shiftId}
                                    state={entry.state}
                                    shifts={grid.shifts}
                                    stateColors={grid.stateColors}
                                    density={density}
                                  />
                                </span>
                              ) : (
                                <Chip
                                  key={entry.id}
                                  shiftId={entry.shiftId}
                                  state={entry.state}
                                  shifts={grid.shifts}
                                  stateColors={grid.stateColors}
                                  density={density}
                                />
                              ),
                            )}
                          </span>
                        ) : (
                          <span className="flex flex-col items-center gap-0.5">
                            {cells.map((entry) => {
                              const v = cellView(entry, view);
                              return (
                                <span key={entry.id} className="flex flex-col items-center">
                                  <Chip
                                    shiftId={v.shiftId}
                                    state={v.state}
                                    shifts={grid.shifts}
                                    stateColors={grid.stateColors}
                                    density={density}
                                  />
                                  {/* Where a travelling person spent the day. Initials
                                      only — the cell is 1.9rem wide — with the full
                                      names on the cell's tooltip. */}
                                  {entry.locationIds.length > 0 ? (
                                    <span className="text-[8px] leading-none text-muted-foreground">
                                      {entry.locationIds
                                        .map((id) => siteInitials(grid.locationOptions, id))
                                        .join("+")}
                                    </span>
                                  ) : null}
                                </span>
                              );
                            })}
                          </span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The brush controls for the current multi-day selection: set a shift, a state, or clear. */
function SelectionToolbar({
  scheduleId,
  selection,
  memberName,
  shifts,
  stateColors,
  siteOptions,
  onAddWeekday,
  onDone,
  onChanged,
}: {
  scheduleId: string;
  selection: Selection;
  memberName: string;
  shifts: Shift[];
  stateColors: ScheduleStateColors;
  /** The sites a day may be tagged with. Empty on a site rota, which needs no tag. */
  siteOptions: { id: string; name: string }[];
  onAddWeekday: (match: "weekend" | number) => void;
  onDone: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  // Where the selected days were spent. Carried on the same apply as the shift, so
  // "Tuesday and Wednesday, general shift, at Plant A and Plant B" is one action.
  const [whereIds, setWhereIds] = useState<string[]>([]);
  const apply = useMutation({
    mutationFn: (set: { shiftId: string | null; state: EntryState } | null) =>
      bulkAssign(scheduleId, {
        userId: selection.userId,
        dates: selection.dates,
        set,
        ...(siteOptions.length > 0 && whereIds.length > 0 ? { locationIds: whereIds } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["schedule"] });
      onChanged();
      onDone();
    },
  });
  const busy = apply.isPending;

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
      <span className="text-sm font-medium">
        {memberName} · {selection.dates.length} {selection.dates.length === 1 ? "day" : "days"}
      </span>
      <select
        aria-label="Add all of a weekday"
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
        value=""
        onChange={(e) => {
          if (e.target.value === "") return;
          onAddWeekday(e.target.value === "weekend" ? "weekend" : Number(e.target.value));
        }}
      >
        <option value="">Add all…</option>
        <option value="0">All Sundays</option>
        <option value="1">All Mondays</option>
        <option value="2">All Tuesdays</option>
        <option value="3">All Wednesdays</option>
        <option value="4">All Thursdays</option>
        <option value="5">All Fridays</option>
        <option value="6">All Saturdays</option>
        <option value="weekend">All weekends</option>
      </select>
      {/* The shifts as buttons, in their own colours — one click to paint, and the
          toolbar doubles as the legend. They were behind a "Set shift…" dropdown,
          which put the thing a scheduler reaches for all day two clicks away while
          W/O, L and PH sat in the open beside it. */}
      {shifts.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={busy}
          onClick={() => apply.mutate({ shiftId: s.id, state: "working" })}
          title={`${s.name} · ${formatMinutesOfDay(s.startMinute)}–${formatMinutesOfDay(s.endMinute)}`}
          className={cn(
            "h-8 min-w-[2.2rem] rounded-md px-2 text-sm font-bold transition hover:opacity-90 disabled:opacity-50",
            cellClasses(s.color),
          )}
        >
          {s.code}
        </button>
      ))}
      {siteOptions.length > 0 ? (
        <span className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Where</span>
          <MultiSelect
            ariaLabel={`Sites for ${memberName}`}
            options={siteOptions.map((site) => ({ value: site.id, label: site.name }))}
            values={whereIds}
            onChange={setWhereIds}
            placeholder="Not said"
            disabled={busy}
          />
        </span>
      ) : null}
      {/* The same shape for the three states, in the colours the calendar uses for
          them, so the toolbar and the grid never disagree about what leave looks like. */}
      {(["off", "leave", "holiday"] as const).map((st) => (
        <button
          key={st}
          type="button"
          disabled={busy}
          onClick={() => apply.mutate({ shiftId: null, state: st })}
          title={ENTRY_STATE_LABELS[st]}
          className={cn(
            "h-8 min-w-[2.6rem] whitespace-nowrap rounded-md px-2 text-sm font-bold transition hover:opacity-90 disabled:opacity-50",
            cellClasses(stateColors[st]),
          )}
        >
          {ENTRY_STATE_CODES[st]}
        </button>
      ))}
      <Button disabled={busy} onClick={() => apply.mutate(null)}>
        Clear
      </Button>
      <button
        type="button"
        onClick={onDone}
        aria-label="Cancel selection"
        className="ml-1 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      {apply.error ? (
        <span className="text-xs text-destructive">
          {String(apply.error as Error)?.replace("Error: ", "") || "Could not apply"}
        </span>
      ) : null}
    </div>
  );
}

/** Small pill button used inside the toolbar. */
function Button({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 rounded-md border border-border bg-background px-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
    >
      {children}
    </button>
  );
}
