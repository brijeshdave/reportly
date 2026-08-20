// Author: Brijesh Dave <https://github.com/brijeshdave>
// The leaderboard as people expect a leaderboard to look — a podium for the top
// three with their faces, a ranked list below, and the points each earned. It reads
// the same ledger the reports do; this is the celebratory face of it.
//
// The department defaults to the viewer's own when they are in exactly one and are
// not management (someone who can see the whole company). Management, and anyone in
// several departments, are asked to pick — a single default would be a guess.
import {
  DEFAULT_LEADERBOARD_LIMIT,
  FINANCIAL_YEAR_MONTHS,
  LEADERBOARD_LIMITS,
  PERMISSIONS,
  currentFinancialYearStart,
  financialYearLabel,
  financialYearOptions,
  monthLabel,
  type LeaderboardEntry,
} from "@reportly/shared";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Crown, Medal, Trophy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Avatar } from "@/components/avatar.js";
import { usePermission } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { Select, Spinner } from "@/components/ui/form.js";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { departmentOptions } from "@/lib/department-options.js";
import { sessionQuery } from "@/lib/queries.js";
import { cn } from "@/lib/cn.js";
import { fetchDepartments, fetchMyDepartments } from "@/services/departments.js";
import { fetchLeaderboard } from "@/services/reports.js";

export function LeaderboardPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  // "Management" = whoever may see company-wide aggregates. They pick a department
  // rather than being defaulted into one.
  const isManagement = session.isSuperadmin || usePermission(PERMISSIONS.ANALYTICS_VIEW);

  // Two sources, and which one is used says who is asking. Management picks any
  // department, so it reads the company list — and only management asks for it, since
  // `departments:read` is the right to enumerate the organisation and seeing your own
  // standing should not carry it. Everybody else picks from their own departments,
  // which /me answers for the caller alone and needs no permission at all.
  const canListDepartments = usePermission(PERMISSIONS.DEPARTMENTS_READ);
  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: fetchDepartments,
    enabled: isManagement && canListDepartments,
  });
  const myDepartments = useQuery({
    queryKey: ["users", "departments", session.user.id],
    queryFn: () => fetchMyDepartments(),
  });

  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [fyStart, setFyStart] = useState<number>(() => currentFinancialYearStart());
  // null = the whole financial year; otherwise a 1-based calendar month within it.
  const [month, setMonth] = useState<number | null>(null);
  const [limit, setLimit] = useState<number>(DEFAULT_LEADERBOARD_LIMIT);

  // The financial years to choose from — the current one down to the app's first,
  // so next April's year appears on its own with no code change.
  const fyOptions = financialYearOptions();
  const periodLabel =
    month == null
      ? financialYearLabel(fyStart)
      : `${monthLabel(month)} · ${financialYearLabel(fyStart)}`;

  // The default department, once we know who the viewer is: their own when they are
  // in exactly one and not management; otherwise "unset", so we prompt.
  const [touched, setTouched] = useState(false);
  const mine = myDepartments.data ?? [];
  const defaultDept = !isManagement && mine.length === 1 ? mine[0]!.departmentId : null;
  const effectiveDept = touched ? departmentId : (departmentId ?? defaultDept);
  const mustChoose = effectiveDept === null;

  const board = useQuery({
    queryKey: ["leaderboard", effectiveDept, fyStart, month, limit],
    queryFn: () =>
      fetchLeaderboard({
        departmentId: effectiveDept ?? undefined,
        fyStart,
        month: month ?? undefined,
        limit,
      }),
    enabled: !mustChoose,
  });

  // Flat from the API; each option carries its ancestors as a second line so a
  // department deep in the tree still says where it sits.
  const options = departmentOptions(
    departments.data
      ? departments.data.map((d) => ({ value: d.id, name: d.name, path: d.path }))
      : mine.map((d) => ({ value: d.departmentId, name: d.name, path: d.path })),
  );
  const entries = board.data?.entries ?? [];
  const podium = entries.filter((e) => e.rank <= 3);
  const rest = entries.filter((e) => e.rank > 3);

  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="Who is out in front, by points earned. Pick a department, a timeline, and how many places to show."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <SearchableSelect
                ariaLabel="Department"
                value={effectiveDept ?? ""}
                onChange={(value) => {
                  setTouched(true);
                  setDepartmentId(value || null);
                }}
                options={options}
                placeholder={isManagement ? "Choose a department…" : "All departments"}
              />
            </div>
            <Select
              aria-label="Financial year"
              value={String(fyStart)}
              onChange={(e) => setFyStart(Number(e.target.value))}
              className="w-40"
            >
              {fyOptions.map((y) => (
                <option key={y} value={y}>
                  {financialYearLabel(y)}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Period"
              value={month == null ? "" : String(month)}
              onChange={(e) => setMonth(e.target.value === "" ? null : Number(e.target.value))}
              className="w-44"
            >
              <option value="">Full year</option>
              {FINANCIAL_YEAR_MONTHS.map((m) => (
                <option key={m.month} value={m.month}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="How many"
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="w-28"
            >
              {LEADERBOARD_LIMITS.map((n) => (
                <option key={n} value={n}>
                  Top {n}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {mustChoose ? (
        <EmptyState
          icon={Trophy}
          title="Pick a department"
          description={
            isManagement
              ? "You can see any department. Choose one above to see its leaderboard, or “All departments”."
              : "Choose a department above to see its leaderboard."
          }
        />
      ) : board.isLoading ? (
        <Spinner />
      ) : board.error ? (
        <ErrorAlert error={board.error} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No points yet"
          description="Nobody has earned points in this timeline. Once resolved work is scored, they will appear here."
        />
      ) : (
        <div className="flex flex-col gap-6 pt-2">
          <p className="text-sm text-muted-foreground">
            {board.data?.departmentName ? (
              <>
                <span className="font-medium text-foreground">{board.data.departmentName}</span>{" "}
                ·{" "}
              </>
            ) : null}
            {board.data?.totalPeople} scored · {periodLabel}
          </p>

          <Podium entries={podium} />

          {rest.length > 0 ? (
            <Card className="divide-y divide-border overflow-hidden">
              {rest.map((entry) => (
                <Row key={entry.userId} entry={entry} />
              ))}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}

/** The top three, arranged 2 — 1 — 3, the tallest in the middle. */
function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const byRank = (r: number) => entries.find((e) => e.rank === r);
  // Left = 2nd, middle = 1st, right = 3rd; skip a plinth with nobody on it.
  const order = [byRank(2), byRank(1), byRank(3)].filter(Boolean) as LeaderboardEntry[];

  return (
    <div className="flex items-end justify-center gap-3 sm:gap-6">
      {order.map((entry) => (
        <Plinth key={entry.userId} entry={entry} />
      ))}
    </div>
  );
}

const PLINTH: Record<number, { h: string; ring: string; badge: string; label: string }> = {
  1: {
    h: "h-28 sm:h-36",
    ring: "ring-amber-400",
    badge: "bg-amber-400 text-amber-950",
    label: "1st",
  },
  2: {
    h: "h-20 sm:h-24",
    ring: "ring-slate-300",
    badge: "bg-slate-300 text-slate-800",
    label: "2nd",
  },
  3: {
    h: "h-16 sm:h-20",
    ring: "ring-amber-700/70",
    badge: "bg-amber-700 text-amber-50",
    label: "3rd",
  },
};

function Plinth({ entry }: { entry: LeaderboardEntry }) {
  const s = PLINTH[entry.rank] ?? PLINTH[3]!;
  return (
    <div className="flex w-24 flex-col items-center gap-2 sm:w-32">
      {entry.rank === 1 ? <Crown className="h-6 w-6 text-amber-400" aria-hidden /> : null}
      <JournalLink entry={entry} className="relative transition-transform hover:-translate-y-0.5">
        <Avatar
          userId={entry.userId}
          name={entry.name}
          version={entry.avatarVersion}
          size="xl"
          className={cn("ring-4 ring-offset-2 ring-offset-background", s.ring)}
        />
        <span
          className={cn(
            "absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-xs font-bold shadow",
            s.badge,
          )}
        >
          {s.label}
        </span>
      </JournalLink>
      <JournalLink
        entry={entry}
        className="mt-1 max-w-full truncate text-center text-sm font-semibold hover:underline"
      >
        {entry.name}
      </JournalLink>
      <p className="text-lg font-bold tabular-nums">{entry.points}</p>
      <div
        className={cn(
          "flex w-full items-start justify-center rounded-t-xl bg-gradient-to-b from-muted to-muted/40 pt-2 text-xs text-muted-foreground",
          s.h,
        )}
      >
        pts
      </div>
    </div>
  );
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="w-6 shrink-0 text-center text-sm font-semibold text-muted-foreground tabular-nums">
        {entry.rank}
      </span>
      <JournalLink entry={entry} className="shrink-0 transition-transform hover:-translate-y-0.5">
        <Avatar userId={entry.userId} name={entry.name} version={entry.avatarVersion} size="sm" />
      </JournalLink>
      <JournalLink
        entry={entry}
        className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
      >
        {entry.name}
      </JournalLink>
      {entry.team > 0 ? (
        <Badge tone="neutral" className="hidden sm:inline-flex">
          <Medal className="mr-1 h-3 w-3" />
          {entry.own} + {entry.team} team
        </Badge>
      ) : null}
      <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums">
        {entry.points}
      </span>
    </div>
  );
}

/** A link from a person on the board to their own journal entries — "their reports". */
function JournalLink({
  entry,
  className,
  children,
}: {
  entry: LeaderboardEntry;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to="/journal"
      search={{ authorId: entry.userId }}
      title={`View ${entry.name}'s journal`}
      aria-label={`View ${entry.name}'s journal entries`}
      className={className}
    >
      {children}
    </Link>
  );
}
