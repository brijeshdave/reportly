// Author: Brijesh Dave <https://github.com/brijeshdave>
// The backup scheduling maths in isolation — when a run is due, and the retention cutoff.
import { describe, expect, it } from "vitest";

import { isBackupDue, retentionCutoff } from "@/features/backups/config.js";

const at = (iso: string) => new Date(iso);

describe("isBackupDue", () => {
  it("is never due when off", () => {
    expect(isBackupDue("off", null, at("2026-08-02T00:00:00Z"))).toBe(false);
  });

  it("is due when there has never been a run", () => {
    expect(isBackupDue("daily", null, at("2026-08-02T00:00:00Z"))).toBe(true);
  });

  it("waits the interval between runs", () => {
    const last = at("2026-08-01T00:00:00Z");
    // Daily: due a day later, not twelve hours later.
    expect(isBackupDue("daily", last, at("2026-08-01T12:00:00Z"))).toBe(false);
    expect(isBackupDue("daily", last, at("2026-08-02T00:00:00Z"))).toBe(true);
    // Weekly waits seven days.
    expect(isBackupDue("weekly", last, at("2026-08-06T00:00:00Z"))).toBe(false);
    expect(isBackupDue("weekly", last, at("2026-08-08T00:00:00Z"))).toBe(true);
  });
});

describe("retentionCutoff", () => {
  it("is null when retention is disabled", () => {
    expect(retentionCutoff(0, at("2026-08-02T00:00:00Z"))).toBeNull();
  });
  it("is N days before now", () => {
    expect(retentionCutoff(30, at("2026-08-31T00:00:00Z"))?.toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
});
