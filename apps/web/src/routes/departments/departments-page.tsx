// Author: Brijesh Dave <https://github.com/brijeshdave>
// Departments for the active company, drawn as the tree they form via `parentId`.
// Departments belong to a company (like locations), so this page acts on the one
// selected in the top-bar switcher; with "All companies" chosen there is no single
// company to manage, and the page says so.
import { PERMISSIONS, type DepartmentNode } from "@reportly/shared";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, ChevronRight, Download, Network, Plus, Upload, UserRound } from "lucide-react";
import { useState } from "react";

import { Can, usePermission } from "@/components/can.js";
import { ImportDialog } from "@/components/import-dialog.js";
import { sessionQuery } from "@/lib/queries.js";
import { Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import {
  downloadDepartmentTemplate,
  exportDepartments,
  fetchDepartments,
  importDepartments,
} from "@/services/departments.js";

interface TreeNode extends DepartmentNode {
  depth: number;
  children: TreeNode[];
}

/** Assemble the flat list into a name-ordered forest, tagging each node's depth. */
function buildTree(nodes: DepartmentNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(
    nodes.map((n) => [n.id, { ...n, depth: 0, children: [] }]),
  );
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const ordered: TreeNode[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
      node.depth = depth;
      ordered.push(node);
      walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return ordered;
}

export function DepartmentsPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const companyName = session.companies.find((c) => c.id === session.companyId)?.name;

  return (
    <>
      <PageHeader
        title="Departments"
        description={
          companyName
            ? `The organisation structure of ${companyName}. A user can belong to several departments and be Head of Department (HOD) of any of them.`
            : "The organisation structure of a company."
        }
        actions={session.companyId ? <DepartmentActions /> : null}
      />

      {session.companyId ? (
        <DepartmentTree key={session.companyId} />
      ) : (
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher to see and manage its departments."
        />
      )}
    </>
  );
}

function DepartmentActions() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canImport = usePermission(PERMISSIONS.DEPARTMENTS_IMPORT);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" onClick={() => void exportDepartments()}>
        <Download className="h-4 w-4" /> Export
      </Button>
      {canImport ? (
        <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4" /> Import
        </Button>
      ) : null}
      <Can permission={PERMISSIONS.DEPARTMENTS_CREATE}>
        <Button size="sm" onClick={() => void navigate({ to: "/departments/new" })}>
          <Plus className="h-4 w-4" />
          New department
        </Button>
      </Can>

      {importOpen ? (
        <ImportDialog
          title="Import departments"
          description="Each row is a full path from the root — missing parents are created, and an existing path has its status updated. Membership is set per person elsewhere. If any row is wrong, nothing is saved."
          onClose={() => setImportOpen(false)}
          downloadTemplate={downloadDepartmentTemplate}
          runImport={importDepartments}
          onImported={() => queryClient.invalidateQueries({ queryKey: ["departments"] })}
        />
      ) : null}
    </div>
  );
}

function DepartmentTree() {
  const departments = useQuery({
    queryKey: ["departments", "list"],
    queryFn: fetchDepartments,
  });

  if (departments.isLoading) return <Spinner />;
  if (departments.error) return <ErrorAlert error={departments.error} />;

  const nodes = departments.data ?? [];
  if (nodes.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No departments yet"
        description="Create the first department to start building the org tree."
      />
    );
  }

  const tree = buildTree(nodes);

  return (
    <Card className="divide-y divide-border">
      {tree.map((node) => (
        <Link
          key={node.id}
          to="/departments/$departmentId"
          params={{ departmentId: node.id }}
          className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
          style={{ paddingLeft: `${node.depth * 1.5 + 1}rem` }}
        >
          {node.depth > 0 ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Network className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{node.name}</span>
          {node.status === "inactive" ? <Badge tone="neutral">Inactive</Badge> : null}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" />
            {node.memberCount}
            {node.hodCount > 0 ? (
              <span className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {node.hodCount} HOD
              </span>
            ) : null}
          </span>
        </Link>
      ))}
    </Card>
  );
}
