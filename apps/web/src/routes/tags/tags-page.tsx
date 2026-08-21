// Author: Brijesh Dave <https://github.com/brijeshdave>
// Tags, on their own screen.
//
// They used to be a tab on Journal setup, beside the severity ladder and the status
// workflow. That grouping was about where the words are *used*; `tags:manage` is a
// permission in its own right, and somebody who holds only that one had to open a
// page of four catalogues they may not touch to reach the one they own. A separate
// permission deserves a separate place to exercise it.
import { PERMISSIONS } from "@reportly/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";

import { usePermission } from "@/components/can.js";
import { EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { sessionQuery } from "@/lib/queries.js";
import { TagsTab } from "@/routes/tags/tags-tab.js";

export function TagsPage() {
  const canManage = usePermission(PERMISSIONS.TAGS_MANAGE);
  const { data: session } = useSuspenseQuery(sessionQuery);

  const header = (
    <PageHeader
      title="Tags"
      description="Free labels for finding work later — as many per entry as apply. Each belongs to a department, which is what keeps one team's vocabulary out of another's."
    />
  );

  // Tags belong to a company's departments, so the API cannot answer without
  // knowing which company: with "All companies" chosen it returns 400, and a
  // reference id would stand where an instruction belongs.
  if (!session.companyId) {
    return (
      <>
        {header}
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher. Tags belong to a company's departments, so there is nothing to show until one is chosen."
        />
      </>
    );
  }

  return (
    <>
      {header}
      <TagsTab canManage={canManage} />
    </>
  );
}
