// Author: Brijesh Dave <https://github.com/brijeshdave>
// Placeholder pages for the shell. Real screens land in Phase 3 · Steps 2-5.
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, FileText, Lock, SearchX, Users } from "lucide-react";

import { Button, EmptyState, PageHeader, StatCard } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";

export function DashboardPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  return (
    <>
      <PageHeader title="Dashboard" description="An overview of the company you are working in." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Companies" value={session.companies.length} icon={Building2} />
        <StatCard label="Your groups" value={session.groups.length} icon={Users} />
        <StatCard label="Permissions" value={session.permissions.length} icon={FileText} />
      </div>
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
