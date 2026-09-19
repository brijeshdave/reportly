// Author: Brijesh Dave <https://github.com/brijeshdave>
// The named views a Reviews "Read all" link opens a list on.
//
// Asked for from use: "In review page for all different sections i need something
// like Read All that redirect me that page with applied filters." The link names a
// view rather than carrying the filters, so this file is the one place both sides
// read — and these tests are what stops a view quietly meaning something different
// from the card that links to it.
import { describe, expect, it } from "vitest";

import { JOURNAL_VIEWS, isJournalView, isTaskView, taskViewFilters } from "@/lib/list-views.js";

describe("the journal views", () => {
  it("narrows every view to entries a reviewer can act on", () => {
    // Each card on the Reviews page is about work waiting for a score, so each view
    // must carry the same "waiting" state — a link that dropped it would open on
    // everything, which is the opposite of what the card summarised.
    for (const view of Object.values(JOURNAL_VIEWS)) {
      expect(view.filters).toContainEqual({ field: "reviewState", op: "eq", value: "waiting" });
    }
  });

  it("asks a different question of each part of the line", () => {
    const team = (name: keyof typeof JOURNAL_VIEWS) =>
      JOURNAL_VIEWS[name].filters.find((f) => f.field === "team")?.value;
    expect(team("mine-waiting")).toBe("me");
    expect(team("direct-waiting")).toBe("direct");
    // Deeper in the line is everyone but me and my direct reports — which is
    // exactly the "others" scope.
    expect(team("deeper-waiting")).toBe("others");
  });

  it("trusts only the names it knows", () => {
    // A view arrives in the URL, so anything else is ignored rather than acted on.
    expect(isJournalView("mine-waiting")).toBe(true);
    expect(isJournalView("everything")).toBe(false);
    expect(isJournalView(undefined)).toBe(false);
  });
});

describe("the task views", () => {
  it("names the reader, because 'tasks I assigned' is about who is looking", () => {
    expect(taskViewFilters("assigned-open", "u-1")).toEqual([
      { field: "assignerId", op: "eq", value: "u-1" },
      { field: "state", op: "in", value: ["open", "in_progress"] },
    ]);
  });

  it("trusts only the names it knows", () => {
    expect(isTaskView("assigned-open")).toBe(true);
    expect(isTaskView("all-of-them")).toBe(false);
  });
});
