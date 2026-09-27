// Author: Brijesh Dave <https://github.com/brijeshdave>
// Every rung of the severity ladder looks different from the one beside it.
//
// Reported from use: "Informational and minor badges has same colors and looks." They
// did. The tone came from bucketing a 0–1 share into four bands, and the default
// ladder has five rungs — so Informational (0.00) and Minor (0.25) both landed in the
// bottom band and came out the same green. A ladder nobody can read the steps of is a
// sort key wearing a colour.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SeverityBadge } from "@/components/report-badges.js";

vi.mock("@/services/journal-config.js", () => ({
  fetchSeverities: () =>
    Promise.resolve(
      ["Informational", "Minor", "Moderate", "Major", "Critical"].map((name, orderIndex) => ({
        id: `s-${orderIndex}`,
        name,
        orderIndex,
        status: "active",
      })),
    ),
}));

function renderLadder(names: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {names.map((name) => (
        <SeverityBadge key={name} name={name} />
      ))}
    </QueryClientProvider>,
  );
}

/** The tone classes a badge carries, which is what "looks the same" means here. */
function toneOf(name: string): string {
  return screen.getByText(name).className;
}

describe("SeverityBadge", () => {
  it("gives every rung of the seeded ladder its own look", async () => {
    renderLadder(["Informational", "Minor", "Moderate", "Major", "Critical"]);
    // Waiting on the catalogue actually landing. A badge has classes from the moment
    // it renders, so waiting for "not empty" waits for nothing at all.
    await waitFor(() => expect(toneOf("Critical")).toContain("destructive"));

    const tones = ["Informational", "Minor", "Moderate", "Major", "Critical"].map(toneOf);
    // The failure as it was reported: the first two were identical.
    expect(tones[0]).not.toBe(tones[1]);
    expect(new Set(tones).size).toBe(5);
  });

  it("keeps the top of the ladder the loudest and the bottom the quietest", async () => {
    renderLadder(["Informational", "Critical"]);
    await waitFor(() => expect(toneOf("Critical")).toContain("destructive"));

    expect(toneOf("Informational")).toContain("muted");
  });

  it("says the word even before the catalogue has arrived", async () => {
    // A missing colour is a smaller fault than a missing label.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SeverityBadge name="Critical" />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });
});
