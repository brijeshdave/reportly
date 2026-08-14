// Author: Brijesh Dave <https://github.com/brijeshdave>
// The vocabulary the asset tree is built from. This is the screen that makes the tree
// mean something in an industry other than the one it shipped for: rename Line to
// Ward and the same structure describes a hospital.
import { PERMISSIONS, type AssetTypeRow, type CreateAssetType } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { ImportDialog } from "@/components/import-dialog.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card } from "@/components/ui/primitives.js";
import { usePermission } from "@/components/can.js";
import {
  createAssetType,
  deleteAssetType,
  downloadAssetTypeTemplate,
  exportAssetTypes,
  fetchAssetTypes,
  importAssetTypes,
  updateAssetType,
} from "@/services/assets.js";

export function AssetTypesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const types = useQuery({ queryKey: ["asset-types"], queryFn: fetchAssetTypes });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["asset-types"] });

  const canImport = usePermission(PERMISSIONS.ASSET_TYPES_IMPORT);
  const [importOpen, setImportOpen] = useState(false);

  const [draft, setDraft] = useState<CreateAssetType>({
    name: "",
    orderIndex: 0,
    tracksDowntime: true,
    status: "active",
  });

  const create = useMutation({
    mutationFn: () =>
      createAssetType({
        ...draft,
        name: draft.name.trim(),
        orderIndex: types.data?.length ?? 0,
      }),
    onSuccess: async () => {
      setDraft({ name: "", orderIndex: 0, tracksDowntime: true, status: "active" });
      await refresh();
    },
  });

  if (types.isLoading) return <Spinner />;
  if (types.error) return <ErrorAlert error={types.error} />;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-lg text-sm text-muted-foreground">
          What kinds of thing your structure is made of. These ship as a factory&rsquo;s — Plant,
          Building, Area, Line, Station — because that is what Reportly was first used for. They are
          yours to rename.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => void exportAssetTypes()}>
            <Download className="h-4 w-4" /> Export
          </Button>
          {canImport ? (
            <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Import
            </Button>
          ) : null}
        </div>
      </div>

      {importOpen ? (
        <ImportDialog
          title="Import asset types"
          description="Types are matched by name — an existing type has its order and status updated, and a new name is created. If any row is wrong, nothing is saved."
          onClose={() => setImportOpen(false)}
          downloadTemplate={downloadAssetTypeTemplate}
          runImport={importAssetTypes}
          onImported={refresh}
        />
      ) : null}

      <Card className="divide-y divide-border">
        <div className="grid grid-cols-[1fr_5rem_7rem_5rem_auto] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Name</span>
          <span>In use</span>
          <span title="Whether an outage on one of these stops production and is worth recording">
            Records
          </span>
          <span>Status</span>
          <span />
        </div>
        {(types.data ?? []).map((type) => (
          <TypeRow key={type.id} type={type} canManage={canManage} onChange={refresh} />
        ))}
      </Card>

      {canManage ? (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold">Add a type</h3>
          {create.error ? <ErrorAlert error={create.error} /> : null}
          <div className="flex items-end gap-3">
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Name</span>
              <Input
                value={draft.name}
                onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
                placeholder="e.g. Warehouse"
              />
            </label>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={create.isPending || draft.name.trim() === ""}
            >
              {create.isPending ? <Spinner /> : null}
              Add
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function TypeRow({
  type,
  canManage,
  onChange,
}: {
  type: AssetTypeRow;
  canManage: boolean;
  onChange: () => void;
}) {
  const [name, setName] = useState(type.name);
  const active = type.status === "active";

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateAssetType>[1]) => updateAssetType(type.id, patch),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: () => deleteAssetType(type.id), onSuccess: onChange });

  const dirty = name.trim() !== type.name;

  return (
    <>
      <div className="grid grid-cols-[1fr_5rem_7rem_5rem_auto] items-center gap-3 px-4 py-2 text-sm">
        {canManage ? (
          <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
        ) : (
          <span className="font-medium">{type.name}</span>
        )}
        <span className="tabular-nums text-muted-foreground">{type.assetCount}</span>
        {/* Whether an outage on one of these is worth recording. Per type rather
            than per asset: every Line stops production and no Desktop does, so
            it is one decision for a handful of types instead of one per machine. */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={type.tracksDowntime}
            disabled={!canManage || save.isPending}
            aria-label={`${type.name} records downtime`}
            onChange={(event) => save.mutate({ tracksDowntime: event.target.checked })}
          />
          downtime
        </label>
        {canManage ? (
          <button
            type="button"
            onClick={() => save.mutate({ status: active ? "inactive" : "active" })}
            title={active ? "Retire" : "Reactivate"}
          >
            <Badge tone={active ? "success" : "neutral"}>{active ? "active" : "retired"}</Badge>
          </button>
        ) : (
          <Badge tone={active ? "success" : "neutral"}>{active ? "active" : "retired"}</Badge>
        )}
        <div className="flex items-center gap-1">
          {canManage ? (
            <>
              {dirty ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => save.mutate({ name: name.trim() })}
                  disabled={save.isPending}
                >
                  Save
                </Button>
              ) : null}
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${type.name}`}
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {remove.error ? (
        <div className="px-4 pb-2">
          <ErrorAlert error={remove.error} />
        </div>
      ) : null}
    </>
  );
}
