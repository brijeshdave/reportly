// Author: Brijesh Dave <https://github.com/brijeshdave>
// Named views a link can open a list on — the "Read all" behind each Reviews section.
//
// Asked for from use: "In review page for all different sections i need something
// like Read All that redirect me that page with applied filters." Each section is a
// short summary of a question the full table can answer properly — sorted, paged,
// exported — and the link is how you get from one to the other without rebuilding
// the question by hand.
//
// Named rather than carried as JSON in the URL. A name is a readable link that can
// be pasted to a colleague; a serialised filter array is neither, and it would let
// anybody craft an arbitrary filter into a URL. The views live here, in one place,
// so the Reviews page and the list pages cannot disagree about what a view means.
import type { Filter } from "@reportly/shared";

/** The journal views, and what each one narrows to. */
export const JOURNAL_VIEWS = {
  /** Your own entries, resolved and waiting for a reviewer. */
  "mine-waiting": {
    label: "Your entries waiting to be scored",
    filters: [
      { field: "team", op: "eq", value: "me" },
      { field: "reviewState", op: "eq", value: "waiting" },
    ],
  },
  /**
   * Your direct reports' entries, waiting for you.
   *
   * `direct` includes your own entries — "the caller is always in their own team
   * view" — so the table can show one or two more rows than the Reviews card, which
   * leaves your own out because nobody reviews their own work. A small superset is
   * the honest reading of the same question; no scope expresses "direct reports but
   * not me", and inventing one for a link would be a third meaning of "my team".
   */
  "direct-waiting": {
    label: "Entries awaiting your review",
    filters: [
      { field: "team", op: "eq", value: "direct" },
      { field: "reviewState", op: "eq", value: "waiting" },
    ],
  },
  /** Deeper in your line — waiting on the managers between you and the author. */
  "deeper-waiting": {
    label: "Waiting on your managers",
    filters: [
      { field: "team", op: "eq", value: "others" },
      { field: "reviewState", op: "eq", value: "waiting" },
    ],
  },
} as const satisfies Record<string, { label: string; filters: Filter[] }>;

export type JournalView = keyof typeof JOURNAL_VIEWS;

export const isJournalView = (value: unknown): value is JournalView =>
  typeof value === "string" && value in JOURNAL_VIEWS;

/**
 * The task views. A function of the reader, because "tasks I assigned" names them —
 * there is no filter value that means "me", and inventing one server-side would be
 * a second way to spell a user id.
 */
export function taskViewFilters(view: TaskView, userId: string): Filter[] {
  switch (view) {
    case "assigned-open":
      return [
        { field: "assignerId", op: "eq", value: userId },
        { field: "state", op: "in", value: ["open", "in_progress"] },
      ];
  }
}

export const TASK_VIEWS = {
  "assigned-open": { label: "Tasks you assigned, still open" },
} as const;

export type TaskView = keyof typeof TASK_VIEWS;

export const isTaskView = (value: unknown): value is TaskView =>
  typeof value === "string" && value in TASK_VIEWS;
