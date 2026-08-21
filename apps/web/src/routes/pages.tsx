// Author: Brijesh Dave <https://github.com/brijeshdave>
// Placeholder pages for the shell. Real screens land in Phase 3 · Steps 2-5.
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, FileText, Lock, SearchX, Users } from "lucide-react";

import { Button, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";

export function DashboardPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);

  // An account with no company, or with no group, is an account that can do nothing
  // — an empty sidebar, and a 403 from everything it tries. That reads as a broken
  // app rather than an unfinished setup, so it says which of the two it is and what
  // has to happen next. Neither is something the person can fix themselves.
  const missing = !session.isSuperadmin
    ? session.companies.length === 0
      ? {
          title: "You have not been given a company yet",
          description:
            "Your account exists, but it is not attached to a company, so there is nothing to show. Ask an administrator to add you to one.",
        }
      : session.permissions.length === 0
        ? {
            title: "You are not in a group yet",
            description:
              "An account grants an identity, not permission — the group you are put in decides what you may open. Ask an administrator to add you to one.",
          }
        : null
    : null;

  return (
    <>
      <PageHeader title="Dashboard" description="An overview of the company you are working in." />
      {missing ? (
        <EmptyState icon={Lock} title={missing.title} description={missing.description} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="Companies" value={session.companies.length} icon={Building2} />
          <StatCard label="Your groups" value={session.groups.length} icon={Users} />
          <StatCard label="Permissions" value={session.permissions.length} icon={FileText} />
        </div>
      )}
    </>
  );
}

export function ForbiddenPage() {
  return (
    <EmptyState
      icon={Lock}
      title="You don't have access to this page"
      description="Ask an administrator to add you to a group that grants this permission."
      action={
        <Link to="/">
          <Button size="sm">Back to dashboard</Button>
        </Link>
      }
    />
  );
}

export function NotFoundPage() {
  return (
    <div className="p-6">
      <EmptyState
        icon={SearchX}
        title="Page not found"
        description="The page you are looking for doesn't exist or has moved."
        action={
          <Link to="/">
            <Button size="sm">Back to dashboard</Button>
          </Link>
        }
      />
    </div>
  );
}
