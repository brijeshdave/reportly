// Author: Brijesh Dave <https://github.com/brijeshdave>
// Two admin surfaces that a unit test can't really cover: a settings change that
// has to round-trip to the server and survive a reload, and the log viewer's live
// tail, which only means anything against a running pipeline producing lines.
import { expect, test } from "@playwright/test";

test("a settings change is saved and survives a reload", async ({ page }) => {
  // The logging sinks are three plain booleans — the least fiddly setting to flip.
  await page.goto("/settings?tab=logging");
  const sinks = page.locator("section, div").filter({ hasText: "logging.sinks" }).last();
  const fileSink = page.getByLabel(/^file$/i);

  const wasChecked = await fileSink.isChecked();
  await fileSink.setChecked(!wasChecked);
  await sinks.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/saved\. applies immediately/i)).toBeVisible();

  // The real test is that it persisted: reload and read it back from the server.
  await page.reload();
  await page.goto("/settings?tab=logging");
  await expect(page.getByLabel(/^file$/i)).toBeChecked({ checked: !wasChecked });

  // Put it back so the suite leaves no trace.
  await page.getByLabel(/^file$/i).setChecked(wasChecked);
  await sinks.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/saved\. applies immediately/i)).toBeVisible();
});

test("the log viewer's live tail streams new lines", async ({ page }) => {
  await page.goto("/logs");
  await page.getByRole("tab", { name: /live tail/i }).click();

  // The tail polls; serving requests writes log lines, so it is never truly idle.
  // Generate a little traffic and expect the count to climb off zero.
  await expect(page.getByText(/Live · every \d+s/i)).toBeVisible();
  await page.goto("/users");
  await page.goto("/companies");
  await page.goto("/logs");
  await page.getByRole("tab", { name: /live tail/i }).click();

  await expect(page.getByText(/· [1-9]\d* lines/i)).toBeVisible({ timeout: 20_000 });
});
