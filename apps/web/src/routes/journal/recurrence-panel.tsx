// Author: Brijesh Dave <https://github.com/brijeshdave>
// "This has happened before" — the explicit recurrence chain, on the report itself.
//
// The panel hides entirely when the chain is empty, rather than saying "no
// recurrences". A first occurrence is the normal case, and a card announcing that
// nothing has gone wrong repeatedly would sit on nearly every report in the system,
// training people to ignore the one place it matters.
import { formatDate } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Repeat } from "lucide-react";

import { Badge, Card } from "@/components/ui/primitives.js";
import { fetchRecurrences } from "@/services/analytics.js";

export function RecurrencePanel({ reportId }: { reportId: string }) {
  const chain = useQuery({
    queryKey: ["reports", reportId, "recurrences"],
    queryFn: () => fetchRecurrences(reportId),
  });

  const links = chain.data ?? [];
  if (links.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Repeat className="h-4 w-4" />
        Seen before
        <Badge tone="danger">{links.length}×</Badge>
      </h2>
      <p className="text-xs text-muted-foreground">
        {/* The count is what the *caller* may see, which can be lower than the truth
            — a chain is not a back door into reports outside their line. Saying so
            here beats a manager wondering why their count differs from someone
            else's. */}
        Other reports linked to this one. You only see the ones you have access to.
      </p>
      <ol className="flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.reportId}>
            <Link
              to="/journal/$reportId"
              params={{ reportId: l.reportId }}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-sm hover:bg-muted"
            >
              <span className="min-w-0 truncate">
                {l.title}
                {l.severityName ? (
                  <span className="ml-2 text-xs text-muted-foreground">{l.severityName}</span>
                ) : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatDate(l.reportDate)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
