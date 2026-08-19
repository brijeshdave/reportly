// Author: Brijesh Dave <https://github.com/brijeshdave>
// The asset tree — the structural things a report can be about. Deliberately small:
// this is the plant, its lines and their stations, not every machine in the building.
// The many (devices) live in a flat registry next door and reach the tree through the
// asset they stand at.
//
// The API sends the assets flat; the tree is assembled here from parentId, the same
// way the departments page does it.
import { PERMISSIONS, type AssetNode } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Building2, ChevronDown, ChevronRight, Download, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { usePermission } from "@/components/can.js";
import { sessionQuery } from "@/lib/queries.js";
import { fetchLocations } from "@/services/locations.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Select, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives.js";
import { AssetImportDialog } from "@/routes/assets/asset-import-dialog.js";
import {
  createAsset,
  deleteAsset,
  exportAssets,
  fetchAssetTypeOptions,
  fetchAssets,
  updateAsset,
} from "@/services/assets.js";

interface TreeNode extends AssetNode {
  children: TreeNode[];
}

/** Flat rows → a tree. An asset whose parent is missing is shown as a root, so a
 * broken link never hides part of the plant. */
function buildTree(rows: AssetNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) sortRec(node.children);
  };
  sortRec(roots);
  return roots;
}

export function AssetTreeTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQuery);
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: fetchAssets,
    // A tree belongs to a company. Without one the request can only 400, so ask for
    // the company rather than firing it and showing the caller a header error.
    enabled: Boolean(session.companyId),
  });
  const types = useQuery({ queryKey: ["asset-types", "options"], queryFn: fetchAssetTypeOptions });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["assets"] });
  const tree = useMemo(() => buildTree(assets.data ?? []), [assets.data]);

  // Where a new asset is being added: the parent's id, or null for a new root.
  const [addingUnder, setAddingUnder] = useState<string | null | undefined>(undefined);
  const canImport = usePermission(PERMISSIONS.ASSETS_IMPORT);
  const [importOpen, setImportOpen] = useState(false);

  if (!session.companyId) {
    return (
      <EmptyState
        icon={Building2}
        title="Pick a company first"
        description="Choose a company in the top-bar switcher to see and manage its assets."
      />
    );
  }
  if (assets.isLoading) return <Spinner />;
  if (assets.error) return <ErrorAlert error={assets.error} />;

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          The structural things reports are filed against — a plant, its lines, the stations on
          them. Keep it small: individual machines belong in <strong>Devices</strong>, where they
          are searched rather than browsed, and still roll up through the asset they stand at.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => void exportAssets()}>
            <Download className="h-4 w-4" /> Export
          </Button>
          {canImport ? (
            <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Import
            </Button>
          ) : null}
        </div>
      </div>

      {importOpen ? <AssetImportDialog onClose={() => setImportOpen(false)} /> : null}

      <Card className="divide-y divide-border">
        {tree.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nothing here yet. Add your plant, then the lines under it.
          </p>
        ) : (
          tree.map((node) => (
            <AssetRow
              key={node.id}
              node={node}
              depth={0}
              canManage={canManage}
              types={types.data ?? []}
              onChange={refresh}
              addingUnder={addingUnder}
              setAddingUnder={setAddingUnder}
            />
          ))
        )}
      </Card>

      {canManage ? (
        addingUnder === null ? (
          <AddAssetForm
            parentId={null}
            types={types.data ?? []}
            onDone={() => {
              setAddingUnder(undefined);
              void refresh();
            }}
          />
        ) : (
          <div>
            <Button size="sm" variant="secondary" onClick={() => setAddingUnder(null)}>
              <Plus className="h-4 w-4" /> Add a top-level asset
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function AssetRow({
  node,
  depth,
  canManage,
  types,
  onChange,
  addingUnder,
  setAddingUnder,
}: {
  node: TreeNode;
  depth: number;
  canManage: boolean;
  types: { id: string; name: string }[];
  onChange: () => void;
  addingUnder: string | null | undefined;
  setAddingUnder: (id: string | null | undefined) => void;
}) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState(node.name);
  const active = node.status === "active";
  const hasChildren = node.children.length > 0;

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateAsset>[1]) => updateAsset(node.id, patch),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: () => deleteAsset(node.id), onSuccess: onChange });

  const dirty = name.trim() !== node.name;

  return (
    <>
      <div
        className="flex items-center gap-2 px-4 py-2 text-sm"
        style={{ paddingLeft: `${depth * 1.5 + 1}rem` }}
      >
        <button
          type="button"
          className="text-muted-foreground disabled:opacity-0"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasChildren}
          aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {canManage ? (
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 max-w-xs"
            // Editing in place means the name is an input, and an input in a tree of
            // twenty of them announces as a bare textbox with nothing to tell them
            // apart. The chevron beside it names itself for the same reason.
            aria-label={`Asset name: ${node.name}`}
          />
        ) : (
          <span className="font-medium">{node.name}</span>
        )}

        {node.typeName ? <Badge tone="neutral">{node.typeName}</Badge> : null}
        {node.deviceCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            {node.deviceCount} device{node.deviceCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {!active ? <Badge tone="neutral">retired</Badge> : null}

        <div className="ml-auto flex items-center gap-1">
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
                size="sm"
                variant="ghost"
                onClick={() => save.mutate({ status: active ? "inactive" : "active" })}
              >
                {active ? "Retire" : "Reactivate"}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Add under ${node.name}`}
                onClick={() => setAddingUnder(node.id)}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${node.name}`}
                onClick={() => remove.mutate()}
                disabled={remove.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* The API refuses a delete that would orphan history and says why; show it. */}
      {remove.error ? (
        <div className="px-4 pb-2" style={{ paddingLeft: `${depth * 1.5 + 2.5}rem` }}>
          <ErrorAlert error={remove.error} />
        </div>
      ) : null}

      {addingUnder === node.id ? (
        <div style={{ paddingLeft: `${depth * 1.5 + 2.5}rem` }} className="px-4 py-2">
          <AddAssetForm
            parentId={node.id}
            parentLocationId={node.locationId}
            types={types}
            onDone={() => {
              setAddingUnder(undefined);
              onChange();
            }}
          />
        </div>
      ) : null}

      {open
        ? node.children.map((child) => (
            <AssetRow
              key={child.id}
              node={child}
              depth={depth + 1}
              canManage={canManage}
              types={types}
              onChange={onChange}
              addingUnder={addingUnder}
              setAddingUnder={setAddingUnder}
            />
          ))
        : null}
    </>
  );
}

function AddAssetForm({
  parentId,
  parentLocationId = null,
  types,
  onDone,
}: {
  parentId: string | null;
  /** The parent's site, if any — a new child defaults to it so the tree stays placed. */
  parentLocationId?: string | null;
  types: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState("");
  const [locationId, setLocationId] = useState(parentLocationId ?? "");

  // Scoped by the API to the sites this caller's groups reach, so the picker never
  // offers one the save would then refuse.
  const locations = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  const create = useMutation({
    mutationFn: () =>
      createAsset({
        name: name.trim(),
        parentId,
        typeId: typeId || null,
        locationId: locationId || null,
        status: "active",
      }),
    onSuccess: onDone,
  });

  return (
    <Card className="flex flex-col gap-3 p-3">
      {create.error ? <ErrorAlert error={create.error} /> : null}
      <div className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Name</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Line 3"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Type</span>
          <Select value={typeId} onChange={(event) => setTypeId(event.target.value)}>
            <option value="">No type</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Site</span>
          {/* Unset means "not placed", which stays visible to everyone — an
              unplaced asset is unplaced, not restricted. */}
          <SearchableSelect
            ariaLabel="Site"
            value={locationId}
            onChange={setLocationId}
            options={(locations.data ?? []).map((location) => ({
              value: location.id,
              label: location.name,
            }))}
            placeholder="Not set"
          />
        </label>
        <Button
          size="sm"
          onClick={() => create.mutate()}
          disabled={create.isPending || name.trim() === ""}
        >
          {create.isPending ? <Spinner /> : null}
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
