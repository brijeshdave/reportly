// Author: Brijesh Dave <https://github.com/brijeshdave>
// Companies list. Creating a company also creates its Remote location, which the
// API guarantees and this page tells the user up front.
import {
  PERMISSIONS,
  createCompanySchema,
  formatDate,
  type Company,
  type CreateCompany,
} from "@reportly/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useForm } from "@/hooks/use-form.js";
import { Badge, Button, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { createCompany } from "@/services/companies.js";

const columns: TableColumn<Company>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Link
        to="/companies/$companyId"
        params={{ companyId: row.original.id }}
        className="font-medium text-foreground hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge tone={row.original.status === "active" ? "success" : "neutral"}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

const filterDefs: FilterDef[] = [
  { field: "createdAt", label: "Created", kind: "daterange" },
  { field: "name", label: "Name", kind: "text" },
  {
    field: "status",
    label: "Status",
    kind: "select",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive" },
    ],
  },
];

export function CompaniesListPage() {
  const [open, setOpen] = useState(false);
  const list = useListResource<Company>({ resource: "companies", path: "/companies" });

  return (
    <>
      <PageHeader
        title="Companies"
        description="Each company owns its locations. Groups scope access to them."
        actions={
          <Can permission={PERMISSIONS.COMPANIES_CREATE}>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              New company
            </Button>
          </Can>
        }
      />

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        emptyTitle="No companies yet"
        emptyDescription="Create one to start adding locations."
        renderCard={(company) => (
          <Link
            to="/companies/$companyId"
            params={{ companyId: company.id }}
            className="text-sm font-medium hover:underline"
          >
            {company.name}
          </Link>
        )}
      />

      {open ? <NewCompanyDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NewCompanyDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The route's own schema, so a name the API refuses lands under the one input
  // this dialog has rather than above it.
  const form = useForm<{ name: string }, CreateCompany>({
    schema: createCompanySchema,
    initial: { name: "" },
    toPayload: (v) => ({ name: v.name.trim() }),
    submit: (input) => createCompany(input.name),
    onSuccess: async (company) => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      onClose();
      await navigate({
        to: "/companies/$companyId",
        params: { companyId: (company as { id: string }).id },
      });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New company"
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-base font-semibold">New company</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A Remote location is created with it, so people without an office still have somewhere to
          report from.
        </p>

        <form {...form.formProps} className="mt-4 flex flex-col gap-4">
          {/* Whatever could not be blamed on a field — a permission, a conflict. */}
          {form.formError ? <ErrorAlert error={form.formError} /> : null}

          <Field label="Name" required error={form.errorFor("name")}>
            {(props) => (
              <Input {...props} {...form.register("name")} autoFocus disabled={form.submitting} />
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={onClose}
              disabled={form.submitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={form.submitting}>
              {form.submitting ? <Spinner /> : null}
              Create company
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
