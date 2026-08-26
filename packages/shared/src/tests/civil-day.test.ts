// Author: Brijesh Dave <https://github.com/brijeshdave>
// Which day an instant falls on, where the installation works.
//
// He operates at +05:30: "i am operating in IST so there should be some settings for
// this". The server decided days with `toISOString().slice(0, 10)`, which is UTC's
// day — so between midnight and 05:30 every night, work was filed against yesterday.
import { describe, expect, it } from "vitest";

import { civilDay, todayIn } from "@/civil-day.js";

describe("the civil day", () => {
  it("is tomorrow in Kolkata while it is still yesterday in UTC", () => {
    // 23:00 UTC on the 23rd is 04:30 on the 24th in Kolkata. This is the window
    // that was being filed under the wrong day.
    const instant = new Date("2026-08-23T23:00:00.000Z");
    expect(civilDay(instant, "UTC")).toBe("2026-08-23");
    expect(civilDay(instant, "Asia/Kolkata")).toBe("2026-08-24");
  });

  it("is still yesterday west of Greenwich", () => {
    // The other direction, so the helper is not merely adding hours.
    const instant = new Date("2026-08-24T02:00:00.000Z");
    expect(civilDay(instant, "UTC")).toBe("2026-08-24");
    expect(civilDay(instant, "America/Chicago")).toBe("2026-08-23");
  });

  it("knows about summer time, which an offset cannot", () => {
    // London is +01:00 in August and +00:00 in January. A stored offset would be
    // wrong for half the year, which is why this takes a zone name.
    expect(civilDay(new Date("2026-08-23T23:30:00.000Z"), "Europe/London")).toBe("2026-08-24");
    expect(civilDay(new Date("2026-01-23T23:30:00.000Z"), "Europe/London")).toBe("2026-01-23");
  });

  it("falls back to UTC rather than throwing on a zone nobody knows", () => {
    // A bad setting should make the day wrong in the way it is wrong today, not
    // stop somebody logging their work.
    expect(civilDay(new Date("2026-08-23T12:00:00.000Z"), "Mars/Olympus")).toBe("2026-08-23");
  });

  it("answers for today too", () => {
    expect(todayIn("UTC")).toBe(new Date().toISOString().slice(0, 10));
  });
});
