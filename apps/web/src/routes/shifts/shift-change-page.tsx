// Author: Brijesh Dave <https://github.com/brijeshdave>
// Shift-change requests: the inbox a reporting manager decides, and the list of the
// ones you raised. A request may only suggest a colleague; the manager confirms one,
// picks a different one, or approves with no swap (taking the person off the shift).
// A requester can withdraw their own while it is still pending. Filters keep a busy
// inbox decidable.
import { formatDate, formatDateTime, type SwapRequest } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftRight, Building2, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { SegmentedTabs } from "@/components/segmented-tabs.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Select, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { cancelSwap, decideSwap, fetchSwaps } from "@/services/shifts.js";

type Box = "inbox" | "mine" | "handled";

const BOX_LABEL: Record<Box, string> = {
  inbox: "To decide",
  mine: "My requests",
  handled: "Decided by me",
};

const STATUS_TONE = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
} as const;

const NO_SWAP = "__none__";

export function ShiftChangePage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const navigate = useNavigate();
  const [box, setBox] = useState<Box>("inbox");
  const swaps = useQuery({ queryKey: ["swaps", box], queryFn: () => fetchSwaps(box) });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | SwapRequest["status"]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows = useMemo(() => {
    const all = swaps.data ?? [];
    const term = search.trim().toLowerCase();
    return (
      all
        .filter((s) => {
          if (status !== "all" && s.status !== status) return false;
          if (from && s.date < from) return false;
          if (to && s.date > to) return false;
          if (term) {
            const hay = `${s.requesterName} ${s.counterpartName ?? ""}`.toLowerCase();
            if (!hay.includes(term)) return false;
          }
          return true;
        })
        // Pending first, then most recent — the ones needing a decision rise to the top.
        .sort((a, b) => {
          if (a.status === "pending" && b.status !== "pending") return -1;
          if (b.status === "pending" && a.status !== "pending") return 1;
          return b.createdAt.localeCompare(a.createdAt);
        })
    );
  }, [swaps.data, search, status, from, to]);

  const pendingCount = (swaps.data ?? []).filter((s) => s.status === "pending").length;

  // Company-scoped: these endpoints answer 400 without the header rather than
  // returning nothing, so with "All companies" chosen the page showed a
  // reference id where an instruction belonged.
  if (!session.companyId) {
    return (
      <>
        <PageHeader title="Shift change" />
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher. Swaps are between colleagues in the same company."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Shift changes"
        description="Ask to change one of your shifts, optionally suggesting a colleague to swap with. Your reporting manager confirms who — or approves with no swap — and the calendar updates."
        actions={
          <Button size="sm" onClick={() => void navigate({ to: "/schedule/changes/new" })}>
            <Plus className="h-4 w-4" />
            Request a change
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedTabs
            ariaLabel="Which requests"
            value={box}
            onChange={setBox}
            segments={(["inbox", "mine", "handled"] as const).map((b) => ({
              value: b,
              label: (
                <>
                  {BOX_LABEL[b]}
                  {b === "inbox" && pendingCount > 0 ? (
                    <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 text-xs font-medium text-warning">
                      {pendingCount}
                    </span>
                  ) : null}
                </>
              ),
            }))}
          />

          {/* Filters — a busy inbox needs narrowing to stay decidable. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search by person"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Person…"
                className="h-8 w-36 pl-7"
              />
            </div>
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              className="h-8 w-32"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <Input
              aria-label="From date"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-36"
            />
            <Input
              aria-label="To date"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-36"
            />
          </div>
        </div>

        {swaps.isLoading ? (
          <Spinner />
        ) : swaps.error ? (
          <ErrorAlert error={swaps.error} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title={(swaps.data ?? []).length === 0 ? "Nothing here" : "Nothing matches"}
            description={
              (swaps.data ?? []).length === 0
                ? box === "inbox"
                  ? "Change requests from the people who report to you appear here."
                  : box === "handled"
                    ? "Requests you have approved or rejected appear here."
                    : "Requests you raise appear here. Use “Request a change”."
                : "No requests match the filters."
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((swap) => (
              <SwapRow key={swap.id} swap={swap} box={box} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SwapRow({ swap, box }: { swap: SwapRequest; box: Box }) {
  const queryClient = useQueryClient();
  // Nothing is pre-selected — the manager must actively choose who to swap with (or no
  // swap) before approving, so an approval is never an accidental default.
  const [choice, setChoice] = useState("");
  // A cross-site trade is a real decision with consequences at two plants, so the
  // approver says why and it is kept with the request.
  const [crossSiteReason, setCrossSiteReason] = useState("");
  const chosenCandidate = swap.candidates.find((c) => c.entryId === choice) ?? null;
  const crossingSites = chosenCandidate?.otherSiteName != null;

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["swaps"] });
    await queryClient.invalidateQueries({ queryKey: ["schedule"] });
  };

  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") =>
      decideSwap(
        swap.id,
        decision,
        decision === "approve"
          ? choice === NO_SWAP
            ? { noSwap: true }
            : {
                counterpartEntryId: choice,
                ...(crossingSites
                  ? { allowCrossSite: true, crossSiteReason: crossSiteReason.trim() }
                  : {}),
              }
          : {},
      ),
    onSuccess: invalidate,
  });
  const withdraw = useMutation({ mutationFn: () => cancelSwap(swap.id), onSuccess: invalidate });

  const canDecide = box === "inbox" && swap.status === "pending" && swap.canDecide;
  const canWithdraw = box === "mine" && swap.status === "pending";

  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium">{swap.requesterName}</span>
          <span className="text-muted-foreground">·</span>
          <Badge tone="brand">{swap.requesterShiftName ?? "shift"}</Badge>
          <span className="text-muted-foreground">{formatDate(`${swap.date}T00:00:00`)}</span>
          <Badge tone={STATUS_TONE[swap.status]}>{swap.status}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {swap.status === "pending"
            ? swap.counterpartName
              ? `Suggested: ${swap.counterpartName} (${swap.counterpartShiftName ?? "—"})`
              : "No suggestion"
            : swap.status === "approved"
              ? swap.counterpartName
                ? `Swapped with ${swap.counterpartName}`
                : "Taken off the shift"
              : swap.status}
          {swap.note ? ` · “${swap.note}”` : ""}
          {swap.crossSite ? ` · across sites: ${swap.crossSiteReason ?? ""}` : ""}
          {swap.decidedAt
            ? ` · ${swap.status} ${formatDateTime(swap.decidedAt)}${
                box !== "handled" && swap.approverName ? ` by ${swap.approverName}` : ""
              }`
            : ""}
        </p>
        {decide.error ? <ErrorAlert error={decide.error} /> : null}
        {withdraw.error ? <ErrorAlert error={withdraw.error} /> : null}
      </div>

      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Resolve by"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            disabled={decide.isPending}
            className="h-8 w-56"
          >
            <option value="">Choose how to resolve…</option>
            {swap.candidates.map((c) => (
              <option key={c.entryId} value={c.entryId}>
                Swap with {c.name} ({c.shiftName ?? "—"})
                {/* Named, because trading a shift with another plant is a different
                    decision from trading it with the person at the next bench. */}
                {c.otherSiteName ? ` · at ${c.otherSiteName}` : ""}
                {c.entryId === swap.counterpartEntryId ? " · suggested" : ""}
              </option>
            ))}
            <option value={NO_SWAP}>No swap — take them off</option>
          </Select>
          {crossingSites ? (
            <Input
              value={crossSiteReason}
              onChange={(e) => setCrossSiteReason(e.target.value)}
              placeholder={`Why swap across to ${chosenCandidate?.otherSiteName}?`}
              aria-label="Reason for a cross-site swap"
              className="h-8 w-64"
            />
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={decide.isPending}
            onClick={() => decide.mutate("reject")}
          >
            Reject
          </Button>
          <Button
            size="sm"
            disabled={
              decide.isPending || !choice || (crossingSites && crossSiteReason.trim().length < 3)
            }
            onClick={() => decide.mutate("approve")}
          >
            Approve
          </Button>
        </div>
      ) : canWithdraw ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={withdraw.isPending}
          onClick={() => withdraw.mutate()}
        >
          Withdraw
        </Button>
      ) : null}
    </Card>
  );
}
