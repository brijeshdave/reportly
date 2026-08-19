// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating and editing a device — a page, not a modal, following the rest of the app.
//
// The "lives at" field is the load-bearing one: it is the only thing connecting a
// flat registry of thousands to the asset tree, and so the only reason a roll-up on
// Line 3 can find the robot standing at its station.
import { PERMISSIONS, type Device } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Can } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { Field, Input, Spinner } from "@/components/ui/form.js";
import { departmentOptions } from "@/lib/department-options.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { createDevice, deleteDevice, fetchAssets, updateDevice } from "@/services/assets.js";
import { AssetCascadePicker } from "@/components/asset-cascade-picker.js";
import { fetchDepartments } from "@/services/departments.js";
import { fetchLocations } from "@/services/locations.js";
import { fetchDeviceTypes } from "@/services/vocabulary.js";
import { http } from "@/services/http.js";

export type DeviceEditorMode = "create" | "edit";

const fetchDevice = (id: string) => http.get<Device>(`/devices/${id}`);

export function DeviceEditorPage({
  mode,
  deviceId,
}: {
  mode: DeviceEditorMode;
  deviceId?: string;
}) {
  const source = useQuery({
    queryKey: ["devices", "detail", deviceId],
    queryFn: () => fetchDevice(deviceId as string),
    enabled: mode === "edit" && Boolean(deviceId),
  });

  if (mode === "edit" && source.isLoading) return <Spinner />;
  if (mode === "edit" && source.error) return <ErrorAlert error={source.error} />;

  return <Editor mode={mode} device={source.data} />;
}

function Editor({ mode, device }: { mode: DeviceEditorMode; device?: Device }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const assets = useQuery({ queryKey: ["assets"], queryFn: fetchAssets });
  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  // Scoped by the API to the sites this user's groups reach, so the picker cannot
  // offer somewhere they would then be refused.
  const locations = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  const [name, setName] = useState(device?.name ?? "");
  const [identifier, setIdentifier] = useState(device?.identifier ?? "");
  const [assetTag, setAssetTag] = useState(device?.assetTag ?? "");
  const [typeId, setTypeId] = useState(device?.typeId ?? "");
  const [locationId, setLocationId] = useState(device?.locationId ?? "");
  const [assetId, setAssetId] = useState(device?.assetId ?? "");
  const [departmentId, setDepartmentId] = useState(device?.departmentId ?? "");

  // Declared after `departmentId` because it depends on it: a device's type comes
  // from its own department's list, so choosing a department changes what is offered.
  const deviceTypes = useQuery({
    queryKey: ["vocabulary", "device-types", departmentId],
    queryFn: () => fetchDeviceTypes(departmentId || undefined),
    enabled: Boolean(departmentId),
  });
  const [active, setActive] = useState((device?.status ?? "active") === "active");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
    // The tree shows a per-asset device count, so it is stale once one moves.
    await queryClient.invalidateQueries({ queryKey: ["assets"] });
    await navigate({ to: "/devices" });
  };

  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        identifier: identifier.trim() || null,
        assetTag: assetTag.trim() || null,
        typeId: typeId || null,
        assetId: assetId || null,
        departmentId: departmentId || null,
        locationId: locationId || null,
        status: active ? ("active" as const) : ("inactive" as const),
      };
      return mode === "edit"
        ? updateDevice(device!.id, input)
        : createDevice({
            ...input,
            identifier: input.identifier ?? undefined,
            assetTag: input.assetTag ?? undefined,
          });
    },
    onSuccess: done,
  });

  const remove = useMutation({ mutationFn: () => deleteDevice(device!.id), onSuccess: done });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <>
      <PageHeader
        title={mode === "edit" ? "Edit device" : "New device"}
        description="A machine, sensor or instrument that reports can be filed against."
        actions={
          <div className="flex items-center gap-2">
            {mode === "edit" ? (
              <Can permission={PERMISSIONS.DEVICES_DELETE}>
                <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </Can>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void navigate({ to: "/devices" })}>
              Back
            </Button>
          </div>
        }
      />

      <Card className="mt-2 max-w-lg p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {save.error ? <ErrorAlert error={save.error} /> : null}
          {remove.error ? <ErrorAlert error={remove.error} /> : null}

          <Field label="Name">
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoFocus
                disabled={save.isPending}
                placeholder="e.g. Robot arm"
              />
            )}
          </Field>

          <Field
            label="Asset ID"
            hint="Your organisation's own number for it. Must be unique across the company, so it can be used to look the device up."
          >
            {(props) => (
              <Input
                {...props}
                value={assetTag}
                onChange={(event) => setAssetTag(event.target.value)}
                disabled={save.isPending}
                placeholder="e.g. ACM-00412"
              />
            )}
          </Field>

          <Field
            label="Serial or vendor code"
            hint="Free text, whatever is stamped on it. Unlike the asset ID this is a note, not a key — it need not be unique."
          >
            {(props) => (
              <Input
                {...props}
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                disabled={save.isPending}
                placeholder="e.g. RA-77"
              />
            )}
          </Field>

          <Field label="Department" hint="Who owns it. The type list comes from this department.">
            {(props) => (
              <SearchableSelect
                {...props}
                value={departmentId}
                onChange={(value) => {
                  setDepartmentId(value);
                  // The types belonged to the old department; keeping one would save
                  // a type this device's owner does not have.
                  setTypeId("");
                }}
                disabled={save.isPending}
                options={departmentOptions(
                  (departments.data ?? []).map((d) => ({
                    value: d.id,
                    name: d.name,
                    path: d.path,
                  })),
                )}
                placeholder="None"
              />
            )}
          </Field>

          <Field
            label="Type"
            hint={
              departmentId
                ? "From this department's list, under Journal setup."
                : "Pick a department first — types are that department's own list."
            }
          >
            {(props) => (
              <SearchableSelect
                {...props}
                value={typeId}
                onChange={setTypeId}
                disabled={save.isPending || !departmentId}
                options={(deviceTypes.data ?? [])
                  .filter((t) => t.status === "active")
                  .map((type) => ({ value: type.id, label: type.name }))}
                placeholder="None"
              />
            )}
          </Field>

          <Field
            label="Site"
            hint="Only the sites you have access to are listed. Leave unset if it is not tied to one."
          >
            {(props) => (
              <SearchableSelect
                {...props}
                value={locationId}
                onChange={setLocationId}
                disabled={save.isPending}
                options={(locations.data ?? []).map((location) => ({
                  value: location.id,
                  label: location.name,
                }))}
                placeholder="Not set"
              />
            )}
          </Field>

          <Field
            label="Lives at"
            hint="The asset it stands at. This is what makes issues on it roll up to the line above."
          >
            {() => (
              // Walked down a level at a time rather than one long list: every step
              // shows only what is inside the previous choice, so names that repeat
              // across plants are never side by side.
              <AssetCascadePicker
                assets={assets.data ?? []}
                value={assetId ? [assetId] : []}
                onChange={(ids) => setAssetId(ids[0] ?? "")}
                multiple={false}
                disabled={save.isPending}
              />
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              disabled={save.isPending}
            />
            Offered when picking what a report is about
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/devices" })}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending || name.trim() === ""}>
              {save.isPending ? <Spinner /> : null}
              {mode === "edit" ? "Save changes" : "Create device"}
            </Button>
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${device?.name}?`}
        description="If any report or downtime names this device, the delete is refused — retire it instead, and the history keeps its label."
        confirmLabel="Delete device"
        destructive
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}
