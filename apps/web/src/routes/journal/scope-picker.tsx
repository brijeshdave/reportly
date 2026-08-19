// Author: Brijesh Dave <https://github.com/brijeshdave>
// Picking what a report is about.
//
// The two halves are picked differently on purpose, because there are different
// numbers of them. Assets, departments and people are a short list you can look
// through, so they get checkbox dropdowns. Devices may run to thousands, so they get
// a search box that asks the server — the same split that keeps the whole scope model
// honest. Everything here is optional: plenty of work is about nothing in particular.
import { type JournalTargetInput, type TargetKind } from "@reportly/shared";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useState } from "react";

import { MultiSelect } from "@/components/multi-select.js";
import type { SelectOption } from "@/components/searchable-select.js";
import { Input, Spinner } from "@/components/ui/form.js";
import { Badge } from "@/components/ui/primitives.js";
import { AssetCascadePicker } from "@/components/asset-cascade-picker.js";
import { departmentOptions } from "@/lib/department-options.js";
import { assetOptions as buildAssetOptions, assetsAtSite } from "@/lib/asset-paths.js";
import { fetchAssets, fetchDevices } from "@/services/assets.js";
import { fetchDepartments, fetchOrgPeople } from "@/services/departments.js";

/** A chosen target, carrying the label so a chip can be drawn without a lookup. */
export interface ScopeTarget extends JournalTargetInput {
  label: string;
}

export function ScopePicker({
  value,
  onChange,
  disabled = false,
  locationId = null,
}: {
  value: ScopeTarget[];
  onChange: (next: ScopeTarget[]) => void;
  disabled?: boolean;
  /** The report's site. When set, the asset picker only offers assets standing there. */
  locationId?: string | null;
}) {
  const assets = useQuery({ queryKey: ["assets"], queryFn: fetchAssets });
  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const people = useQuery({ queryKey: ["org-people"], queryFn: fetchOrgPeople });

  const allAssets = assets.data ?? [];
  // Once a site is chosen, the picker walks only the assets standing at it (plus any not
  // yet placed anywhere); with no site chosen, the whole tree is offered.
  const scopedAssets = assetsAtSite(allAssets, locationId);

  const idsOf = (kind: TargetKind) => value.filter((t) => t.kind === kind).map((t) => t.id);

  /** Replace one kind's picks wholesale, leaving the other kinds untouched. */
  const setKind = (kind: TargetKind, ids: string[], options: SelectOption[]) => {
    const others = value.filter((t) => t.kind !== kind);
    const picked = ids.map((id) => ({
      kind,
      id,
      label: options.find((o) => o.value === id)?.label ?? id,
    }));
    onChange([...others, ...picked]);
  };

  // The full path, not just the name: every plant has a "Station A", and a picker
  // that shows three identical strings offers no way to choose the right one.
  // Labels are resolved from the full tree so an already-chosen asset at another site
  // still draws its chip; only the *choices* are scoped.
  const assetOptions: SelectOption[] = buildAssetOptions(allAssets)
    .filter((a) => a.status === "active")
    .map((a) => ({ value: a.id, label: a.path }));

  // Name first, ancestors underneath — the control has a second line now, so the
  // path no longer has to be crammed into the label.
  const departmentChoices: SelectOption[] = departmentOptions(
    (departments.data ?? []).map((d) => ({ value: d.id, name: d.name, path: d.path })),
  );

  const peopleOptions: SelectOption[] = (people.data ?? []).map((p) => ({
    value: p.userId,
    label: p.name,
  }));

  // The asset chosen most recently — what the device list narrows to.
  const chosenAssets = value.filter((t) => t.kind === "asset");
  const lastAssetId = chosenAssets.length > 0 ? chosenAssets[chosenAssets.length - 1]!.id : null;
  const lastAssetLabel =
    chosenAssets.length > 0 ? chosenAssets[chosenAssets.length - 1]!.label : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Assets get the full width and their own row: the picker walks down the
          tree a level at a time, so it needs room for several dropdowns and for
          chosen paths to wrap rather than be cut off. Departments and people are
          flat lists and still fit side by side below. */}
      <div className="flex w-full flex-col gap-1 text-sm">
        <span className="font-medium">Assets</span>
        <p className="text-xs text-muted-foreground">
          Work down as far as you need and stop — picking a line covers everything on it.
          {locationId ? " Only assets at the chosen site are shown." : ""}
        </p>
        {locationId && scopedAssets.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No assets are placed at this site yet. Set their Site under Assets, or pick a line/plant
            there — everything beneath it is covered.
          </p>
        ) : (
          <AssetCascadePicker
            assets={scopedAssets}
            value={idsOf("asset")}
            onChange={(ids) => setKind("asset", ids, assetOptions)}
            disabled={disabled}
          />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Departments</span>
          <MultiSelect
            ariaLabel="Departments this report is about"
            options={departmentChoices}
            values={idsOf("department")}
            onChange={(ids) => setKind("department", ids, departmentChoices)}
            placeholder="None"
            disabled={disabled}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">People</span>
          <MultiSelect
            ariaLabel="People this report is about"
            options={peopleOptions}
            values={idsOf("user")}
            onChange={(ids) => setKind("user", ids, peopleOptions)}
            placeholder="None"
            disabled={disabled}
          />
        </label>
      </div>

      <DeviceSearch
        chosen={value.filter((t) => t.kind === "device")}
        onAdd={(target) =>
          value.some((t) => t.kind === "device" && t.id === target.id)
            ? undefined
            : onChange([...value, target])
        }
        disabled={disabled}
        // The most recently added asset: after choosing a line, its machines are
        // what you are about to reach for.
        assetId={lastAssetId}
        assetLabel={lastAssetLabel}
      />

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((target) => (
            <span
              key={`${target.kind}:${target.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs"
            >
              <span className="text-muted-foreground">{target.kind}</span>
              {target.label}
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Remove ${target.label}`}
                  onClick={() =>
                    onChange(value.filter((t) => !(t.kind === target.kind && t.id === target.id)))
                  }
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nothing picked — that is fine. Some work is not about any particular thing.
        </p>
      )}
    </div>
  );
}

/**
 * Devices are searched, not listed. The query goes to the server on every keystroke
 * past the second, so a registry of thousands costs one small page of results rather
 * than a dropdown nobody can scroll.
 */
/**
 * Devices, narrowed to the asset just picked.
 *
 * Once somebody has said "Line 3", the machines that matter are the ones standing
 * at Line 3 — a handful, worth listing outright. Searching the whole register at
 * that point makes them type a name they can already see on the panel in front of
 * them. With no asset chosen it falls back to search across the company, because
 * a register of thousands cannot be browsed.
 */
function DeviceSearch({
  chosen,
  onAdd,
  disabled,
  assetId,
  assetLabel,
}: {
  chosen: ScopeTarget[];
  onAdd: (target: ScopeTarget) => void;
  disabled: boolean;
  assetId: string | null;
  assetLabel: string | null;
}) {
  const [term, setTerm] = useState("");
  const searching = term.trim().length >= 2;
  // Listing an asset's devices needs no search term; searching the whole register
  // does, or the first keystroke would ask for every device in the company.
  const enabled = !disabled && (searching || Boolean(assetId));

  const results = useQuery({
    queryKey: ["devices", "search", term, assetId],
    queryFn: () =>
      fetchDevices({
        page: 1,
        pageSize: 10,
        sortBy: "name",
        sortDir: "asc",
        filters: [
          ...(assetId ? [{ field: "assetId", op: "eq" as const, value: assetId }] : []),
          ...(searching ? [{ field: "name", op: "contains" as const, value: term.trim() }] : []),
          { field: "status", op: "eq" as const, value: "active" },
        ],
      }),
    enabled,
  });

  const chosenIds = new Set(chosen.map((c) => c.id));

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">Devices</span>
      <p className="text-xs text-muted-foreground">
        {assetLabel
          ? `The machines at ${assetLabel}. Type to narrow them, or to search the whole register.`
          : "Pick an asset above to see its machines, or search the whole register."}
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={assetLabel ? `Narrow the list at ${assetLabel}…` : "Search by name or tag…"}
          className="pl-9"
          disabled={disabled}
        />
      </div>

      {enabled ? (
        <div className="mt-1 rounded-xl border border-border bg-card">
          {results.isLoading ? (
            <div className="p-2">
              <Spinner />
            </div>
          ) : (results.data?.data.length ?? 0) === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              {assetId && !searching
                ? "No devices are registered at this asset."
                : "No device matches that."}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {(results.data?.data ?? []).map((device) => (
                <li key={device.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                    disabled={chosenIds.has(device.id)}
                    onClick={() =>
                      onAdd({
                        kind: "device",
                        id: device.id,
                        label: device.identifier
                          ? `${device.name} (${device.identifier})`
                          : device.name,
                      })
                    }
                  >
                    <span>{device.name}</span>
                    {device.identifier ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {device.identifier}
                      </span>
                    ) : null}
                    {device.assetName ? (
                      <Badge tone="neutral" className="ml-auto">
                        {device.assetName}
                      </Badge>
                    ) : null}
                    {chosenIds.has(device.id) ? (
                      <span className="ml-auto text-xs text-muted-foreground">added</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </label>
  );
}
