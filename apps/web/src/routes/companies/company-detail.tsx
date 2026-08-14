// Author: Brijesh Dave <https://github.com/brijeshdave>
// Company detail. Locations are listed here rather than on their own page: they
// only exist inside a company, and the API scopes them that way too.
import { PERMISSIONS, type Company } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Can, usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { HistoryTab } from "@/components/history-tab.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import {
  UnsavedChangesNotice,
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/components/unsaved-changes.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { LocationsTab } from "@/routes/companies/locations-tab.js";
import { ModulesTab } from "@/routes/companies/modules-tab.js";
import {
  deleteCompany,
  fetchCompany,
  fetchCompanyReferences,
  setCompanyStatus,
  updateCompany,
} from "@/services/companies.js";

const TABS = [
  { id: "locations", label: "Locations" },
  { id: "modules", label: "Modules" },
  { id: "settings", label: "Settings" },
  { id: "history", label: "History" },
];

export function CompanyDetailPage({ companyId, tab }: { companyId: string; tab: string }) {
  const tabNavigate = useNavigate({ from: "/companies/$companyId" });
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const canUpdate = usePermission(PERMISSIONS.COMPANIES_UPDATE);
  const queryClient = useQueryClient();

  const company = useQuery({
    queryKey: ["companies", "detail", companyId],
    queryFn: () => fetchCompany(companyId),
  });

  const toggle = useMutation({
    mutationFn: (status: "active" | "inactive") => setCompanyStatus(companyId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["companies"] }),
  });

  if (company.isLoading) return <Spinner />;
  if (company.error) return <ErrorAlert error={company.error} />;
  if (!company.data) return null;

  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "locations";

  return (
    // Panels stay mounted once visited, so a half-typed rename is not lost when
    // you glance at the Locations tab.
    <UnsavedChangesProvider>
      <PageHeader
        title={company.data.name}
        description="Locations belong to this company. Groups scope access to them."
        actions={
          <div className="flex items-center gap-2">
            {company.data.status === "inactive" ? <Badge>Inactive</Badge> : null}

            {canUpdate ? (
              <Button size="sm" variant="secondary" onClick={() => setToggling(true)}>
                {company.data.status === "active" ? "Deactivate" : "Reactivate"}
              </Button>
            ) : null}

            <Can permission={PERMISSIONS.COMPANIES_DELETE}>
              <Button size="sm" variant="destructive" onClick={() => setDeleting(true)}>
                Delete company
              </Button>
            </Can>
          </div>
        }
      />

      <UnsavedChangesNotice />

      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void tabNavigate({ search: { tab: id }, replace: true })}
      />

      <div className="pt-6">
        <TabPanel id="locations" active={activeTab}>
          <LocationsTab companyId={companyId} />
        </TabPanel>
        <TabPanel id="modules" active={activeTab}>
          <ModulesTab companyId={companyId} />
        </TabPanel>
        <TabPanel id="settings" active={activeTab}>
          <RenameCompany companyId={companyId} name={company.data.name} />
        </TabPanel>
        <TabPanel id="history" active={activeTab}>
          <HistoryTab entityType="companies" id={companyId} />
        </TabPanel>
      </div>

      <ConfirmDialog
        open={toggling}
        onClose={() => setToggling(false)}
        title={
          company.data.status === "active"
            ? `Deactivate ${company.data.name}?`
            : `Reactivate ${company.data.name}?`
        }
        description={
          company.data.status === "active"
            ? "It stops being offered for new work. Its locations and every group scoped to it are unchanged, and nothing is deleted."
            : "It becomes available again."
        }
        confirmLabel={company.data.status === "active" ? "Deactivate" : "Reactivate"}
        onConfirm={() =>
          toggle.mutateAsync(company.data!.status === "active" ? "inactive" : "active")
        }
      />

      {deleting ? (
        <DeleteCompanyDialog company={company.data} onClose={() => setDeleting(false)} />
      ) : null}
    </UnsavedChangesProvider>
  );
}

/**
 * Names what the delete destroys before it happens. A company delete cascades
 * into its locations, and through them into every group scoped to one — the API
 * refuses that unless it is asked for explicitly.
 */
function DeleteCompanyDialog({ company, onClose }: { company: Company; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const references = useQuery({
    queryKey: ["companies", "references", company.id],
    queryFn: () => fetchCompanyReferences(company.id),
  });

  const remove = useMutation({
    mutationFn: (cascade: boolean) => deleteCompany(company.id, cascade),
    onSuccess: async () => {
      // A cascade narrowed group scopes, so those views are stale too.
      await queryClient.invalidateQueries({ queryKey: ["groups"] });
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
      await navigate({ to: "/companies" });
    },
  });

  if (references.isLoading) {
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        title={`Delete ${company.name}?`}
        description={<Spinner />}
        confirmLabel="Delete company"
        destructive
        onConfirm={() => Promise.resolve()}
      />
    );
  }

  // Every company has a Remote location, so it can never be what blocks a delete.
  const locations = (references.data?.locations ?? []).filter((l) => l.name !== "Remote");
  const groups = references.data?.groups ?? [];
  const blocked = locations.length > 0 || groups.length > 0;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Delete ${company.name}?`}
      description={
        blocked ? (
          <div className="flex flex-col gap-3">
            {locations.length > 0 ? (
              <p>
                <strong>{locations.length}</strong>{" "}
                {locations.length === 1 ? "location is" : "locations are"} deleted with it:{" "}
                {locations.map((l) => l.name).join(", ")}.
              </p>
            ) : null}
            {groups.length > 0 ? (
              <p>
                <strong>{groups.length}</strong> {groups.length === 1 ? "group" : "groups"} lose
                this company from their scope, changing what their members can see:{" "}
                {groups.map((g) => g.name).join(", ")}.
              </p>
            ) : null}
            <p className="text-xs">Deactivating it instead keeps all of this and can be undone.</p>
          </div>
        ) : (
          "Only its Remote location goes with it. This cannot be undone."
        )
      }
      confirmLabel={blocked ? "Delete company and everything above" : "Delete company"}
      destructive
      onConfirm={() => remove.mutateAsync(blocked)}
    />
  );
}

function RenameCompany({ companyId, name }: { companyId: string; name: string }) {
  const [value, setValue] = useState(name);
  const canUpdate = usePermission(PERMISSIONS.COMPANIES_UPDATE);
  const queryClient = useQueryClient();

  useUnsavedChanges("settings", value.trim() !== name);

  const rename = useMutation({
    mutationFn: () => updateCompany(companyId, value.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });

  return (
    <Card className="max-w-lg p-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          rename.mutate();
        }}
        className="flex flex-col gap-4"
      >
        {rename.error ? <ErrorAlert error={rename.error} /> : null}
        {rename.isSuccess && value.trim() === name ? (
          <Alert tone="success">Company renamed.</Alert>
        ) : null}

        <Field label="Company name">
          {(props) => (
            <Input
              {...props}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={!canUpdate || rename.isPending}
            />
          )}
        </Field>

        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={
              !canUpdate || rename.isPending || value.trim() === "" || value.trim() === name
            }
          >
            {rename.isPending ? <Spinner /> : null}
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}
