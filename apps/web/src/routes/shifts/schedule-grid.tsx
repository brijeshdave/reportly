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
  type Shift,
} from "@reportly/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";

import { Avatar } from "@/components/avatar.js";
import { MultiSelect } from "@/components/ui/multi-select.js";
import { cn } from "@/lib/cn.js";
import { SHIFT_COLOR_CLASSES, STATE_CHIP } from "@/routes/shifts/shift-colors.js";
import { bulkAssign } from "@/services/shifts.js";

export type ScheduleView = "actual" | "scheduled" | "changes";

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

function Chip({
  shiftId,
  state,
  shifts,
}: {
  shiftId: string | null;
  state: EntryState;
  shifts: Shift[];
}) {
  if (state !== "working") {
    return (
      <span
        className={cn("rounded px-1 text-[10px] font-semibold leading-4", STATE_CHIP[state])}
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
        "min-w-[1.4rem] rounded px-1 text-center text-[10px] font-bold leading-4",
        SHIFT_COLOR_CLASSES[shift.color].chip,
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
}: {
  grid: ScheduleGrid;
  view: ScheduleView;
  canManage: boolean;
  onChanged: () => void;
}) {
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
          siteOptions={grid.locationOptions}
          onAddWeekday={addWeekday}
          onDone={() => setSelection(null)}
          onChanged={onChanged}
        />
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[9rem] border-b border-r border-border bg-card px-3 py-2 text-left text-xs font-semibold">
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
                      "border-b border-border px-0 py-1 text-center text-[11px] font-medium",
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
                    <span className="truncate text-xs font-medium">{member.name}</span>
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
                        "relative border-b border-l border-border p-0 text-center align-middle",
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
                          "flex min-h-[1.9rem] w-full items-center justify-center px-0.5",
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
                              "text-[10px]",
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
                                    />
                                  </span>
                                  <Chip
                                    shiftId={entry.shiftId}
                                    state={entry.state}
                                    shifts={grid.shifts}
                                  />
                                </span>
                              ) : (
                                <Chip
                                  key={entry.id}
                                  shiftId={entry.shiftId}
                                  state={entry.state}
                                  shifts={grid.shifts}
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
                                  <Chip shiftId={v.shiftId} state={v.state} shifts={grid.shifts} />
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
  siteOptions,
  onAddWeekday,
  onDone,
  onChanged,
}: {
  scheduleId: string;
  selection: Selection;
  memberName: string;
  shifts: Shift[];
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
      <select
        aria-label="Set shift"
        className="h-8 rounded-md border border-border bg-background px-2 text-sm"
        value=""
        disabled={busy}
        onChange={(e) =>
          e.target.value && apply.mutate({ shiftId: e.target.value, state: "working" })
        }
      >
        <option value="">Set shift…</option>
        {shifts.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} · {s.name}
          </option>
        ))}
      </select>
      {siteOptions.length > 0 ? (
        <span className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Where</span>
          <MultiSelect
            label={`Sites for ${memberName}`}
            options={siteOptions.map((site) => ({ value: site.id, label: site.name }))}
            selected={whereIds}
            onChange={setWhereIds}
            emptyLabel="Not said"
            disabled={busy}
          />
        </span>
      ) : null}
      {(["off", "leave", "holiday"] as const).map((st) => (
        <Button key={st} disabled={busy} onClick={() => apply.mutate({ shiftId: null, state: st })}>
          {ENTRY_STATE_CODES[st]}
        </Button>
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
