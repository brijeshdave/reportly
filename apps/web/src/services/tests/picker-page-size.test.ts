// Author: Brijesh Dave <https://github.com/brijeshdave>
// The "load everything for a picker" fetches ask a list endpoint for one big page.
// The API only accepts the page sizes its own tables offer, so an oversized ask is a
// 400 — and a rejected fetch reaches the screen as a dropdown that is simply empty,
// with nothing on it to explain why. This pins the two together.
import { PAGE_SIZE_OPTIONS } from "@reportly/shared";
import { describe, expect, it } from "vitest";

import { PICKER_PAGE_SIZE } from "@/services/http.js";

describe("PICKER_PAGE_SIZE", () => {
  it("is a size the API will accept", () => {
    expect(PAGE_SIZE_OPTIONS as readonly number[]).toContain(PICKER_PAGE_SIZE);
  });

  it("is the largest allowed, so a picker loads as much as it may in one call", () => {
    expect(PICKER_PAGE_SIZE).toBe(Math.max(...PAGE_SIZE_OPTIONS));
  });
});
