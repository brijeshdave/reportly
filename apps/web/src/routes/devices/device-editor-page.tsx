// Author: Brijesh Dave <https://github.com/brijeshdave>
// Creating and editing a device — a page, not a modal, following the rest of the app.
//
// The "lives at" field is the load-bearing one: it is the only thing connecting a
// flat registry of thousands to the asset tree, and so the only reason a roll-up on
// Line 3 can find the robot standing at its station.
import { PERMISSIONS, createDeviceSchema, type CreateDevice, type Device } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Can } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { Field, Input, Spinner } from "@/components/ui/form.js";
import { useForm } from "@/hooks/use-form.js";
import { departmentOptions } from "@/lib/department-options.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useToast } from "@/components/toaster.js";
import { Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { createDevice, deleteDevice, fetchAssets, updateDevice } from "@/services/assets.js";
import { AssetCascadePicker } from "@/components/asset-cascade-picker.js";
import { fetchDepartments } from "@/services/departments.js";
import { fetchLocations } from "@/services/locations.js";
import { fetchDeviceTypes } from "@/services/vocabulary.js";
import { http } from "@/services/http.js";

/** What the form holds. Text as typed; the payload builder does the converting. */
interface DeviceForm {
  name: string;
  identifier: string;
  assetTag: string;
  typeId: string;
  locationId: string;
  assetId: string;
  departmentId: string;
  active: boolean;
}

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
  const toast = useToast();

  const assets = useQuery({ queryKey: ["assets"], queryFn: fetchAssets });
  const departments = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  // Scoped by the API to the sites this user's groups reach, so the picker cannot
  // offer somewhere they would then be refused.
  const locations = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  // The route's own schema, so what the form refuses and what the API refuses are
  // one rule — and the asset ID's uniqueness, which only the server can know, comes
  // back named and lands under that field rather than above the whole form.
  const form = useForm<DeviceForm, CreateDevice>({
    schema: createDeviceSchema,
    initial: {
      name: device?.name ?? "",
      identifier: device?.identifier ?? "",
      assetTag: device?.assetTag ?? "",
      typeId: device?.typeId ?? "",
      locationId: device?.locationId ?? "",
      assetId: device?.assetId ?? "",
      departmentId: device?.departmentId ?? "",
      active: (device?.status ?? "active") === "active",
    },
    toPayload: (v) => ({
      name: v.name.trim(),
      status: v.active ? "active" : "inactive",
      ...(v.identifier.trim() ? { identifier: v.identifier.trim() } : {}),
      ...(v.assetTag.trim() ? { assetTag: v.assetTag.trim() } : {}),
      ...(v.typeId ? { typeId: v.typeId } : {}),
      ...(v.assetId ? { assetId: v.assetId } : {}),
      ...(v.departmentId ? { departmentId: v.departmentId } : {}),
      ...(v.locationId ? { locationId: v.locationId } : {}),
    }),
    submit: (input) =>
      mode === "edit"
        ? updateDevice(device!.id, {
            ...input,
            // Explicitly null on an edit: an absent key leaves the stored value
            // alone, so clearing any of these would not stick.
            identifier: input.identifier ?? null,
            assetTag: input.assetTag ?? null,
            typeId: input.typeId ?? null,
            assetId: input.assetId ?? null,
            departmentId: input.departmentId ?? null,
            locationId: input.locationId ?? null,
          })
        : createDevice(input),
    onSuccess: (saved) => done(saved as { id: string; name: string }),
  });
  const { typeId, locationId, assetId, departmentId, active } = form.values;

  // Declared after `departmentId` because it depends on it: a device's type comes
  // from its own department's list, so choosing a department changes what is offered.
  const deviceTypes = useQuery({
    queryKey: ["vocabulary", "device-types", departmentId],
    queryFn: () => fetchDeviceTypes(departmentId || undefined),
    enabled: Boolean(departmentId),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** A deletion has nowhere to stay — the thing it was showing is gone. */
  const removed = async () => {
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
    toast.saved("Device deleted.");
    await navigate({ to: "/devices" });
  };

  const done = async (saved: { id: string; name: string }) => {
    await queryClient.invalidateQueries({ queryKey: ["devices"] });
    // The tree shows a per-asset device count, so it is stale once one moves.
    await queryClient.invalidateQueries({ queryKey: ["assets"] });
    toast.saved(mode === "edit" ? "Device saved." : `${saved.name} created.`);
    // An edit stays where it is; a new one opens what was just created.
    if (mode !== "edit") {
      await navigate({ to: "/devices/$deviceId/edit", params: { deviceId: saved.id } });
    }
  };

  const remove = useMutation({ mutationFn: () => deleteDevice(device!.id), onSuccess: removed });

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
        <form {...form.formProps} className="flex flex-col gap-4">
          {/* Whatever could not be blamed on a field — a permission, a conflict. */}
          {form.formError ? <ErrorAlert error={form.formError} /> : null}
          {remove.error ? <ErrorAlert error={remove.error} /> : null}

          <Field label="Name" required error={form.errorFor("name")}>
            {(props) => (
              <Input
                {...props}
                {...form.register("name")}
                autoFocus
                disabled={form.submitting}
                placeholder="e.g. Robot arm"
              />
            )}
          </Field>

          <Field
            label="Asset ID"
            error={form.errorFor("assetTag")}
            hint="Your organisation's own number for it. Must be unique across the company, so it can be used to look the device up."
          >
            {(props) => (
              <Input
                {...props}
                {...form.register("assetTag")}
                disabled={form.submitting}
                placeholder="e.g. ACM-00412"
              />
            )}
          </Field>

          <Field
            label="Serial or vendor code"
            error={form.errorFor("identifier")}
            hint="Free text, whatever is stamped on it. Unlike the asset ID this is a note, not a key — it need not be unique."
          >
            {(props) => (
              <Input
                {...props}
                {...form.register("identifier")}
                disabled={form.submitting}
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
                  form.set("departmentId", value);
                  // The types belonged to the old department; keeping one would save
                  // a type this device's owner does not have.
                  form.set("typeId", "");
                }}
                disabled={form.submitting}
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
                onChange={(value) => form.set("typeId", value)}
                disabled={form.submitting || !departmentId}
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
                onChange={(value) => form.set("locationId", value)}
                disabled={form.submitting}
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
                onChange={(ids) => form.set("assetId", ids[0] ?? "")}
                multiple={false}
                disabled={form.submitting}
              />
            )}
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => form.set("active", event.target.checked)}
              disabled={form.submitting}
            />
            Offered when picking what a report is about
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => void navigate({ to: "/devices" })}
              disabled={form.submitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={form.submitting}>
              {form.submitting ? <Spinner /> : null}
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
