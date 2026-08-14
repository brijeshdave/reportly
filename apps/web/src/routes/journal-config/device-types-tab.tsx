// Author: Brijesh Dave <https://github.com/brijeshdave>
// Device types, owned by a department — Pump, Sensor, Valve. Two departments may
// each keep a "Pump" and mean their own, exactly like categories.
//
// A type that devices already hold cannot be deleted; the API refuses and says how
// many hold it. Retiring stops it being offered while those devices keep their
// label, which is why the status toggle sits next to every row.
import { type DeviceTypeRow, type UpdateDeviceType } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Trash2 } from "lucide-react";
import { useState } from "react";

import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Input, Spinner } from "@/components/ui/form.js";
import { Button, Card, EmptyState } from "@/components/ui/primitives.js";
import { fetchDepartments } from "@/services/departments.js";
import {
  createDeviceType,
  deleteDeviceType,
  fetchDeviceTypes,
  updateDeviceType,
} from "@/services/vocabulary.js";

export function DeviceTypesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const departments = useQuery({ queryKey: ["departments", "list"], queryFn: fetchDepartments });

  const [departmentId, setDepartmentId] = useState<string>("");
  const active = departmentId || departments.data?.[0]?.id || "";

  const types = useQuery({
    queryKey: ["vocabulary", "device-types", active],
    queryFn: () => fetchDeviceTypes(active),
    enabled: Boolean(active),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["vocabulary", "device-types", active] });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createDeviceType({
        departmentId: active,
        name: name.trim(),
        // Off for a new device type: most of the register is desks and laptops,
        // where a failure is a job to do rather than an outage to measure.
        tracksDowntime: false,
        status: "active",
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: async () => {
      setName("");
      setDescription("");
      await refresh();
    },
  });

  if (departments.isLoading) return <Spinner />;
  if (departments.error) return <ErrorAlert error={departments.error} />;

  if ((departments.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No departments yet"
        description="Device types belong to a department. Create a department first, in the company whose org you're setting up."
      />
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <label className="flex max-w-xs flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Department</span>
        <select
          value={active}
          onChange={(event) => setDepartmentId(event.target.value)}
          className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
        >
          {(departments.data ?? []).map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
      </label>

      {types.isLoading ? <Spinner /> : null}
      {types.error ? <ErrorAlert error={types.error} /> : null}

      <Card className="divide-y divide-border">
        <div className="grid grid-cols-[1fr_5rem_auto] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Device type</span>
          <span>Status</span>
          <span />
        </div>
        {(types.data ?? []).length === 0 && !types.isLoading ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No device types in this department yet.
          </p>
        ) : null}
        {(types.data ?? []).map((type) => (
          <DeviceTypeRowItem key={type.id} type={type} canManage={canManage} onChange={refresh} />
        ))}
      </Card>

      {canManage ? (
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-sm font-semibold">Add a device type</h3>
          {create.error ? <ErrorAlert error={create.error} /> : null}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Pump"
              />
            </div>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={create.isPending || name.trim() === ""}
            >
              {create.isPending ? <Spinner /> : null}
              Add
            </Button>
          </div>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What belongs in this type (optional)"
          />
        </Card>
      ) : null}
    </div>
  );
}

function DeviceTypeRowItem({
  type,
  canManage,
  onChange,
}: {
  type: DeviceTypeRow;
  canManage: boolean;
  onChange: () => void;
}) {
  const [name, setName] = useState(type.name);
  const active = type.status === "active";

  const save = useMutation({
    mutationFn: (patch: UpdateDeviceType) => updateDeviceType(type.id, patch),
    onSuccess: onChange,
  });
  const remove = useMutation({ mutationFn: () => deleteDeviceType(type.id), onSuccess: onChange });

  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="grid grid-cols-[1fr_7rem_5rem_auto] items-center gap-3">
        {canManage ? (
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => name.trim() && name !== type.name && save.mutate({ name: name.trim() })}
          />
        ) : (
          <span className="truncate text-sm">{type.name}</span>
        )}

        {/* Most devices are desks and laptops: a dead one is a job to do, not an
            outage to measure. Switch it on for the few that halt something — a
            label printer on the line, say. */}
        <label
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title="Tick when one of these stopping means production stopped. Leave it off for PCs and the like — a downtime record needs a machine that halts something."
        >
          <input
            type="checkbox"
            checked={type.tracksDowntime}
            disabled={!canManage || save.isPending}
            aria-label={`${type.name} records downtime`}
            onChange={(event) => save.mutate({ tracksDowntime: event.target.checked })}
          />
          downtime
        </label>

        <button
          type="button"
          disabled={!canManage || save.isPending}
          onClick={() => save.mutate({ status: active ? "inactive" : "active" })}
          className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline disabled:no-underline"
          title={active ? "Retire this type" : "Bring this type back"}
        >
          {active ? "Active" : "Retired"}
        </button>

        {canManage ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Delete ${type.name}`}
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          <span />
        )}
      </div>

      {type.description ? (
        <p className="text-xs text-muted-foreground">{type.description}</p>
      ) : null}
      {save.error ? <ErrorAlert error={save.error} /> : null}
      {/* A type in use cannot be deleted — the error names how many devices hold it. */}
      {remove.error ? <ErrorAlert error={remove.error} /> : null}
    </div>
  );
}
