// Author: Brijesh Dave <https://github.com/brijeshdave>
// A company's locations: add, rename, deactivate, delete.
//
// Deleting is the dangerous one. `group_locations` cascades in the database, so a
// delete would strip this location from every group scoped to it. The API refuses
// while anything references it and says what does; deactivating is the reversible
// alternative and keeps those scopes intact.
import { PERMISSIONS, type Location } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, MapPin, Pencil, Plus, Power, Trash2, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Can, usePermission } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { ImportDialog } from "@/components/import-dialog.js";
import { Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives.js";
import {
  createLocation,
  deleteLocation,
  downloadLocationTemplate,
  exportLocations,
  fetchCompanyLocations,
  fetchLocationReferences,
  importLocations,
  setLocationStatus,
  updateLocation,
} from "@/services/locations.js";

/**
 * `closed` is passed rather than looked up: a deactivated company refuses every
 * write, so offering buttons that can only fail is a trap. Export stays — reading
 * and exporting is exactly what a closed company is still for.
 */
export function LocationsTab({ companyId, closed }: { companyId: string; closed?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState<Location | null>(null);
  const [toggling, setToggling] = useState<Location | null>(null);

  const canUpdate = usePermission(PERMISSIONS.LOCATIONS_UPDATE);
  const canDelete = usePermission(PERMISSIONS.LOCATIONS_DELETE);
  const canImport = usePermission(PERMISSIONS.LOCATIONS_IMPORT);
  const [importOpen, setImportOpen] = useState(false);
  const queryClient = useQueryClient();

  const locations = useQuery({
    queryKey: ["locations", "of-company", companyId],
    queryFn: () => fetchCompanyLocations(companyId),
  });

  // A group's scope editor lists locations too, so refresh every view of them.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["locations"] });

  const toggle = useMutation({
    mutationFn: (location: Location) =>
      setLocationStatus(
        companyId,
        location.id,
        location.status === "active" ? "inactive" : "active",
      ),
    onSuccess: invalidate,
  });

  if (locations.isLoading) return <Spinner />;
  if (locations.error) return <ErrorAlert error={locations.error} />;

  const rows = locations.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => void exportLocations(companyId)}>
          <Download className="h-4 w-4" /> Export
        </Button>
        {canImport ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setImportOpen(true)}
            disabled={closed}
            title={closed ? "This company is deactivated" : undefined}
          >
            <Upload className="h-4 w-4" /> Import
          </Button>
        ) : null}
        <Can permission={PERMISSIONS.LOCATIONS_CREATE}>
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            disabled={closed}
            title={closed ? "This company is deactivated" : undefined}
          >
            <Plus className="h-4 w-4" />
            Add location
          </Button>
        </Can>
      </div>

      {importOpen ? (
        <ImportDialog
          title="Import locations"
          description="Sites are matched by name — an existing site has its status updated, and a new name is created. If any row is wrong, nothing is saved."
          onClose={() => setImportOpen(false)}
          downloadTemplate={downloadLocationTemplate}
          runImport={(file) => importLocations(companyId, file)}
          onImported={invalidate}
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState icon={MapPin} title="No locations" description="Add the first one." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((location) => (
            <Card key={location.id} className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{location.name}</p>
                {location.isRemote ? (
                  <p className="text-xs text-muted-foreground">
                    Created with the company. It cannot be deleted or deactivated.
                  </p>
                ) : location.status === "inactive" ? (
                  <p className="text-xs text-muted-foreground">
                    Not offered for new work. Group scopes are unchanged.
                  </p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {location.isRemote ? <Badge tone="brand">Remote</Badge> : null}
                {location.status === "inactive" ? <Badge>Inactive</Badge> : null}

                {canUpdate ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Rename ${location.name}`}
                    onClick={() => setRenaming(location)}
                    className="h-8 w-8"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                ) : null}

                {canUpdate && !location.isRemote ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      location.status === "active"
                        ? `Deactivate ${location.name}`
                        : `Reactivate ${location.name}`
                    }
                    onClick={() => setToggling(location)}
                    className="h-8 w-8"
                  >
                    <Power className="h-4 w-4" />
                  </Button>
                ) : null}

                {canDelete && !location.isRemote ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${location.name}`}
                    onClick={() => setDeleting(location)}
                    className="h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {adding ? (
        <LocationNameDialog
          title="Add location"
          description="Names are unique within a company."
          submitLabel="Add location"
          onSubmit={(name) => createLocation(companyId, name)}
          onDone={invalidate}
          onClose={() => setAdding(false)}
        />
      ) : null}

      {renaming ? (
        <LocationNameDialog
          title={`Rename ${renaming.name}`}
          description="Groups scoped to this location keep it; only the name changes."
          submitLabel="Save name"
          initialName={renaming.name}
          onSubmit={(name) => updateLocation(companyId, renaming.id, name)}
          onDone={invalidate}
          onClose={() => setRenaming(null)}
        />
      ) : null}

      <ConfirmDialog
        open={toggling !== null}
        onClose={() => setToggling(null)}
        title={
          toggling?.status === "active"
            ? `Deactivate ${toggling.name}?`
            : `Reactivate ${toggling?.name ?? "this location"}?`
        }
        description={
          toggling?.status === "active"
            ? "It stops being offered for new work. Groups scoped to it keep that scope, and nothing is deleted."
            : "It becomes available again."
        }
        confirmLabel={toggling?.status === "active" ? "Deactivate" : "Reactivate"}
        onConfirm={() => toggle.mutateAsync(toggling!)}
      />

      {deleting ? (
        <DeleteLocationDialog
          companyId={companyId}
          location={deleting}
          onDone={invalidate}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

/** Create and rename differ only in wording and the call they make. */
function LocationNameDialog({
  title,
  description,
  submitLabel,
  initialName = "",
  onSubmit,
  onDone,
  onClose,
}: {
  title: string;
  description: string;
  submitLabel: string;
  initialName?: string;
  onSubmit: (name: string) => Promise<unknown>;
  onDone: () => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);

  const save = useMutation({
    mutationFn: () => onSubmit(name.trim()),
    onSuccess: async () => {
      await onDone();
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          {save.error ? <ErrorAlert error={save.error} /> : null}

          <Field label="Name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                disabled={save.isPending}
              />
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={save.isPending || name.trim() === "" || name.trim() === initialName}
            >
              {save.isPending ? <Spinner /> : null}
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Names the groups a delete would detach before offering to do it. The API would
 * refuse anyway; asking first means the answer arrives before the click, not after.
 */
function DeleteLocationDialog({
  companyId,
  location,
  onDone,
  onClose,
}: {
  companyId: string;
  location: Location;
  onDone: () => Promise<unknown> | unknown;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const references = useQuery({
    queryKey: ["locations", "references", location.id],
    queryFn: () => fetchLocationReferences(companyId, location.id),
  });

  const remove = useMutation({
    mutationFn: (cascade: boolean) => deleteLocation(companyId, location.id, cascade),
    onSuccess: async () => {
      // A cascade changed group scopes, so those views are stale too.
      await queryClient.invalidateQueries({ queryKey: ["groups"] });
      await onDone();
    },
  });

  if (references.isLoading) {
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        title={`Delete ${location.name}?`}
        description={<Spinner />}
        confirmLabel="Delete location"
        destructive
        onConfirm={() => Promise.resolve()}
      />
    );
  }

  const groups = references.data ?? [];
  const blocked = groups.length > 0;

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Delete ${location.name}?`}
      description={
        blocked ? (
          <div className="flex flex-col gap-3">
            <p>
              {groups.length === 1 ? "One group is" : `${groups.length} groups are`} scoped to this
              location. Deleting it removes that scope, which changes what their members can see.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {groups.map((group) => (
                <li key={group.id}>
                  <Link
                    to="/groups/$groupId"
                    params={{ groupId: group.id }}
                    className="inline-block rounded-full border border-border bg-muted px-2.5 py-1 text-xs hover:text-primary"
                  >
                    {group.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-xs">Deactivating it instead keeps every scope and can be undone.</p>
          </div>
        ) : (
          "Nothing references this location. Deleting it cannot be undone."
        )
      }
      confirmLabel={blocked ? "Remove from groups and delete" : "Delete location"}
      destructive
      onConfirm={() => remove.mutateAsync(blocked)}
    />
  );
}
