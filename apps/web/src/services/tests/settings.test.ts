// Author: Brijesh Dave <https://github.com/brijeshdave>
// A setting is stored whole: the server re-parses the value it is given and fills
// any missing field with its default. Sending a partial object therefore resets
// the fields it omits.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveMyTableDefaults } from "@/services/settings.js";

let sentBody: unknown;

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          namespace: "ui",
          key: "tableDefaults",
          userOverridable: true,
          description: "",
          value: (sentBody as { value: unknown }).value,
        }),
        { status: 200 },
      );
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("saveMyTableDefaults", () => {
  it("sends every field, so changing the page size cannot reset the density", async () => {
    await saveMyTableDefaults({ pageSize: 50, density: "compact" });

    expect(sentBody).toEqual({ value: { pageSize: 50, density: "compact" } });
  });

  it("returns the stored value parsed against the shared schema", async () => {
    const saved = await saveMyTableDefaults({ pageSize: 5, density: "comfortable" });
    expect(saved).toEqual({ pageSize: 5, density: "comfortable" });
  });
});
