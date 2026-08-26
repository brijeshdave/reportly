// Author: Brijesh Dave <https://github.com/brijeshdave>
// The catalogues the module runs on: what a part is, what can be done to one, and
// what gets used up doing it.
//
// All three are data rather than code, which is the reason this page exists. The
// module is called Cartridges here because that is what this company refills, but
// nothing underneath knows what toner is — a company tracking UPS batteries fills
// in different words on this page and the rest behaves identically.
//
// Nothing is ever deleted. A service kind that scored somebody's work has to
// survive or the history it scored stops meaning anything, so retirement is
// "no longer offered", never "gone".
import {
  CONSUMABLE_UNITS,
  CONSUMABLE_UNIT_LABELS,
  PERMISSIONS,
  type Consumable,
  type ConsumableUnit,
  type PartModel,
  type ServiceKind,
  type ServiceKindConsumable,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { ExclusivePanels, useExclusivePanel } from "@/routes/parts/use-exclusive-panel.js";

import { Can } from "@/components/can.js";
import { PageTabs, TabPanel } from "@/components/page-tabs.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Field, Input, Select, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { useOptions } from "@/hooks/use-options.js";
import {
  createConsumable,
  createPartModel,
  createServiceKind,
  fetchConsumables,
  fetchPartModels,
  fetchRates,
  fetchServiceKinds,
  setRates,
  updateConsumable,
  updatePartModel,
  updateServiceKind,
} from "@/services/parts.js";

const TABS = [
  { id: "models", label: "Models" },
  { id: "kinds", label: "Service kinds" },
  { id: "consumables", label: "Consumables" },
];

/** The names behind a kind's consumable rules, with "at least" marked. */
function consumableNames(rules: ServiceKindConsumable[], all: Consumable[] | undefined): string {
  return rules
    .map((rule) => {
      const name = all?.find((c) => c.id === rule.consumableId)?.name ?? "one more";
      return rule.minQuantity > 0 ? `${name} (needs ${rule.minQuantity})` : name;
    })
    .join(", ");
}

/** Retire / restore, which is the only thing standing in for delete anywhere here. */
function StatusButton({
  status,
  onToggle,
  busy,
}: {
  status: "active" | "inactive";
  onToggle: () => void;
  busy: boolean;
}) {
  return (
    <Button variant="secondary" size="sm" disabled={busy} onClick={onToggle}>
      {status === "active" ? "Retire" : "Restore"}
    </Button>
  );
}

/** What `/device-types` gives us: the type, and the department that owns it. */
interface DeviceTypeOption {
  id: string;
  name: string;
  departmentName?: string;
}

/** The names behind a model's compatibility ids, for the row's summary line. */
function typeNames(ids: string[], types: DeviceTypeOption[]): string {
  const named = ids.map((id) => types.find((type) => type.id === id)?.name).filter(Boolean);
  // A type this caller cannot see still counts, so the sentence stays true rather
  // than quietly shortening.
  const unknown = ids.length - named.length;
  return [...named, ...(unknown > 0 ? [`${unknown} more`] : [])].join(", ");
}

/**
 * The device types a model fits.
 *
 * Compatibility is by device TYPE, not by device: "this cartridge fits an M404"
 * is a fact about the model, and re-stating it per printer would go stale the
 * first time somebody buys another one.
 *
 * The empty state matters more than the list. A bare legend over nothing reads
 * as a broken screen, when the truth is that this company has no device type for
 * the machine in question yet — and that is fixed somewhere else entirely.
 */
function DeviceTypePicker({
  types,
  selected,
  onChange,
  loading,
}: {
  types: DeviceTypeOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading: boolean;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">Fits these device types</legend>
      <p className="text-xs text-muted-foreground">
        A cartridge in a machine it does not fit will not work whatever the record says, so
        installing to anything else is refused.
      </p>
      {/* Said whether or not the list is empty. It used to appear only when there
          was nothing to show, which is precisely when nobody was looking — a
          reader whose type is missing from a list of five needs this sentence
          more than a reader looking at none. Device types are ASSET types'
          neighbours in the vocabulary and easily confused with them, and they
          are not part of this module at all. */}
      <p className="text-xs text-muted-foreground">
        These come from{" "}
        <Link
          to="/journal-config"
          search={{ tab: "device-types" }}
          className="text-primary hover:underline"
        >
          Journal setup → Device types
        </Link>
        {loading || types.length > 0
          ? " — add one there if the machine you want is missing."
          : ". This company has none yet; add one there, then come back and tick it here."}
      </p>
      {loading ? <Spinner /> : null}
      <div className="grid gap-1 sm:grid-cols-2">
        {types.map((type) => (
          <label key={type.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(type.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, type.id]
                    : selected.filter((id) => id !== type.id),
                )
              }
            />
            <span>
              {type.name}
              {/* A device type belongs to a department, and two departments may
                  name one the same. Without this the duplicate is a coin toss.
                  The space is a real character rather than the margin: the margin
                  is invisible to the accessible name, which would otherwise read
                  "Laptop(IT)". */}
              {type.departmentName ? (
                <>
                  {" "}
                  <span className="text-xs text-muted-foreground">({type.departmentName})</span>
                </>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Change what an existing model fits.
 *
 * Absent until now, and its absence was a hole rather than a decision: a model
 * created before the right device type existed could never be made to fit
 * anything, and every install of every part built on it would be refused with no
 * way to put it right.
 */
function CompatibilityEditor({
  model,
  types,
  loading,
}: {
  model: PartModel;
  types: DeviceTypeOption[];
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const { open, setOpen } = useExclusivePanel(`${model.id}:fits`);
  const [selected, setSelected] = useState<string[]>(model.compatibleDeviceTypeIds);

  const save = useMutation({
    mutationFn: () => updatePartModel(model.id, { compatibleDeviceTypeIds: selected }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["part-models"] });
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          // Re-read from the model each time it opens, so a cancelled edit does
          // not linger as a draft that silently saves later.
          setSelected(model.compatibleDeviceTypeIds);
          setOpen(true);
        }}
      >
        Fits
      </Button>
    );
  }

  return (
    <Card className="order-last w-full space-y-2 p-3">
      {save.error ? <ErrorAlert error={save.error} /> : null}
      <DeviceTypePicker
        types={types}
        selected={selected}
        onChange={setSelected}
        loading={loading}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  );
}

/**
 * The model's own facts: what it is called, and what its maker rates it for.
 *
 * Separate from "Fits" and "Rates" because they answer different questions and
 * are changed at different times — but all three were missing until now, so a
 * model created with a typo or an unknown page yield could never be corrected.
 * The API has always accepted these; only the form was absent.
 */
function ModelDetailsEditor({ model }: { model: PartModel }) {
  const queryClient = useQueryClient();
  const { open, setOpen } = useExclusivePanel(`${model.id}:edit`);
  const [name, setName] = useState(model.name);
  const [cycleLimit, setCycleLimit] = useState(model.cycleLimit?.toString() ?? "");
  const [ratedPageYield, setRatedPageYield] = useState(model.ratedPageYield?.toString() ?? "");

  const save = useMutation({
    mutationFn: () =>
      updatePartModel(model.id, {
        name: name.trim(),
        // Blank means "no rated limit", which is a real answer and not zero — the
        // list already reads it as "no rated limit".
        cycleLimit: cycleLimit.trim() === "" ? null : Number(cycleLimit),
        ratedPageYield: ratedPageYield.trim() === "" ? null : Number(ratedPageYield),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["part-models"] });
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          // Re-read on open, so a cancelled edit leaves no draft behind.
          setName(model.name);
          setCycleLimit(model.cycleLimit?.toString() ?? "");
          setRatedPageYield(model.ratedPageYield?.toString() ?? "");
          setOpen(true);
        }}
      >
        Edit
      </Button>
    );
  }

  return (
    <Card className="order-last w-full space-y-2 p-3">
      {save.error ? <ErrorAlert error={save.error} /> : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Rated services</span>
          <Input
            type="number"
            min={1}
            value={cycleLimit}
            placeholder="no limit"
            onChange={(event) => setCycleLimit(event.target.value)}
            className="h-8"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Rated pages</span>
          <Input
            type="number"
            min={1}
            value={ratedPageYield}
            placeholder="unknown"
            onChange={(event) => setRatedPageYield(event.target.value)}
            className="h-8"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={save.isPending || name.trim() === ""}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

/* --------------------------------- models --------------------------------- */

function ModelsTab() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [cycleLimit, setCycleLimit] = useState("");
  const [ratedPageYield, setRatedPageYield] = useState("");
  const [typeIds, setTypeIds] = useState<string[]>([]);

  const models = useQuery({ queryKey: ["part-models", "all"], queryFn: () => fetchPartModels() });
  // Compatibility is by device TYPE, not by device: "this cartridge fits an
  // M404" is a fact about the model, and re-stating it per printer would go
  // stale the first time somebody buys another one.
  const deviceTypes = useOptions<DeviceTypeOption>("device-types", "/device-types");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["part-models"] });

  const create = useMutation({
    mutationFn: () =>
      createPartModel({
        name,
        compatibleDeviceTypeIds: typeIds,
        ...(cycleLimit ? { cycleLimit: Number(cycleLimit) } : {}),
        ...(ratedPageYield ? { ratedPageYield: Number(ratedPageYield) } : {}),
      }),
    onSuccess: async () => {
      await invalidate();
      setName("");
      setCycleLimit("");
      setRatedPageYield("");
      setTypeIds([]);
      setAdding(false);
    },
  });

  const toggle = useMutation({
    mutationFn: (model: PartModel) =>
      updatePartModel(model.id, { status: model.status === "active" ? "inactive" : "active" }),
    onSuccess: invalidate,
  });

  return (
    <ExclusivePanels>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            A kind of cartridge, what it fits, and how many services its maker rates it for.
          </p>
          <Can permission={PERMISSIONS.PARTS_CONFIGURE}>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Add model
            </Button>
          </Can>
        </div>

        {adding ? (
          <Card className="space-y-3 p-4">
            {create.error ? <ErrorAlert error={create.error} /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                {(props) => (
                  <Input
                    {...props}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="HP 12A Toner"
                  />
                )}
              </Field>
              <Field
                label="Rated cycles"
                hint="Optional. Passing it warns and never refuses — the figure is the maker's opinion."
              >
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min="1"
                    value={cycleLimit}
                    onChange={(e) => setCycleLimit(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="Rated pages"
                hint="Optional. What one charge should produce, to compare each tour against. Leave it empty and you get page counts without a comparison."
              >
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min="1"
                    value={ratedPageYield}
                    onChange={(e) => setRatedPageYield(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <DeviceTypePicker
              types={deviceTypes.data ?? []}
              selected={typeIds}
              onChange={setTypeIds}
              loading={deviceTypes.isLoading}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!name.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                Add
              </Button>
            </div>
          </Card>
        ) : null}

        {models.isLoading ? <Spinner /> : null}
        {models.error ? <ErrorAlert error={models.error} /> : null}

        <ul className="divide-y divide-border rounded-lg border border-border">
          {(models.data ?? []).map((model) => (
            <li key={model.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {model.name}{" "}
                    {model.status === "inactive" ? (
                      <Badge tone="neutral">no longer offered</Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {model.cycleLimit ? `rated for ${model.cycleLimit} services` : "no rated limit"}{" "}
                    ·{" "}
                    {model.ratedPageYield
                      ? `${model.ratedPageYield.toLocaleString()} rated pages`
                      : "no rated pages"}{" "}
                    ·{" "}
                    {/* Named rather than counted. "0 compatible types" is a number
                      somebody has to interpret; "fits nothing yet" is the answer
                      to why every install of this model is being refused. */}
                    {model.compatibleDeviceTypeIds.length === 0
                      ? "fits nothing yet"
                      : `fits ${typeNames(model.compatibleDeviceTypeIds, deviceTypes.data ?? [])}`}
                  </p>
                </div>
                <Can permission={PERMISSIONS.PARTS_CONFIGURE}>
                  {/* `contents` rather than a box: an open editor panel is rendered by one
                    of these buttons, and inside a shrink-to-fit group its `w-full`
                    resolved against the group — which then claimed the row's width
                    and squeezed the name beside it into a column of single letters.
                    With the group's box gone the panel is a child of the wrapping
                    row, where `order-last` puts it on a line of its own beneath. */}
                  <div className="contents">
                    <CompatibilityEditor
                      model={model}
                      types={deviceTypes.data ?? []}
                      loading={deviceTypes.isLoading}
                    />
                    <ModelDetailsEditor model={model} />
                    <RatesEditor model={model} />
                    <StatusButton
                      status={model.status}
                      busy={toggle.isPending}
                      onToggle={() => toggle.mutate(model)}
                    />
                  </div>
                </Can>
              </div>
            </li>
          ))}
        </ul>
        {!models.isLoading && (models.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No models yet.</p>
        ) : null}
      </div>
    </ExclusivePanels>
  );
}

/** What one model pays for one kind of service, overriding the kind's default. */
function RatesEditor({ model }: { model: PartModel }) {
  const queryClient = useQueryClient();
  const { open, setOpen } = useExclusivePanel(`${model.id}:rates`);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const kinds = useQuery({
    queryKey: ["part-service-kinds", "active"],
    queryFn: () => fetchServiceKinds(true),
    enabled: open,
  });
  const rates = useQuery({
    queryKey: ["part-models", model.id, "rates"],
    queryFn: () => fetchRates(model.id),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () =>
      setRates(
        model.id,
        Object.entries(draft)
          .filter(([, points]) => points !== "")
          .map(([serviceKindId, points]) => ({ serviceKindId, points: Number(points) })),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["part-models", model.id, "rates"] });
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Rates
      </Button>
    );
  }

  const current = new Map((rates.data ?? []).map((rate) => [rate.serviceKindId, rate.points]));

  // Opens in flow rather than as an overlay: it is a short list of numbers, and a
  // popover over a list row is a thing to dismiss before reading the row again.
  return (
    <Card className="w-72 space-y-2 p-3">
      <h3 className="text-sm font-semibold">What {model.name} pays</h3>
      <p className="text-xs text-muted-foreground">
        Leave one empty to use the service kind&rsquo;s own default. Refilling a big cartridge is
        not the same job as refilling a small one.
      </p>
      {save.error ? <ErrorAlert error={save.error} /> : null}
      {(kinds.data ?? []).map((kind) => (
        <label key={kind.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate">{kind.name}</span>
          <Input
            type="number"
            min="0"
            step="0.5"
            className="w-20"
            aria-label={`Points for ${kind.name}`}
            placeholder={String(kind.defaultPoints)}
            value={draft[kind.id] ?? current.get(kind.id)?.toString() ?? ""}
            onChange={(e) => setDraft({ ...draft, [kind.id]: e.target.value })}
          />
        </label>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  );
}

/**
 * What a kind may consume, and how much.
 *
 * A refill takes toner and nothing else; a repair takes drums and blades and
 * never toner. Ticking nothing leaves the kind unrestricted, which is what every
 * kind looked like before this existed — narrowing is opt-in.
 */
function KindConsumablesEditor({ kind }: { kind: ServiceKind }) {
  const queryClient = useQueryClient();
  const { open, setOpen } = useExclusivePanel(`${kind.id}:uses`);
  const [rules, setRules] = useState<ServiceKindConsumable[]>(kind.consumables);

  const consumables = useQuery({
    queryKey: ["consumables", "active"],
    queryFn: () => fetchConsumables(true),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => updateServiceKind(kind.id, { consumables: rules }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["part-service-kinds"] });
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setRules(kind.consumables);
          setOpen(true);
        }}
      >
        Uses
      </Button>
    );
  }

  const ruleFor = (id: string) => rules.find((rule) => rule.consumableId === id);
  const setRule = (id: string, next: Partial<ServiceKindConsumable> | null) => {
    setRules((now) => {
      const rest = now.filter((rule) => rule.consumableId !== id);
      if (next === null) return rest;
      const current = now.find((rule) => rule.consumableId === id);
      return [
        ...rest,
        {
          consumableId: id,
          minQuantity: next.minQuantity ?? current?.minQuantity ?? 0,
          maxQuantity:
            next.maxQuantity !== undefined ? next.maxQuantity : (current?.maxQuantity ?? null),
        },
      ];
    });
  };

  return (
    <Card className="order-last w-full space-y-2 p-3">
      <h3 className="text-sm font-semibold">What {kind.name} uses</h3>
      <p className="text-xs text-muted-foreground">
        Tick what this kind may consume. <strong>Least</strong> above zero makes it required — a
        refill that used no toner did not happen. <strong>Most</strong> caps it. Tick nothing and
        the kind stays unrestricted.
      </p>
      {save.error ? <ErrorAlert error={save.error} /> : null}
      {consumables.isLoading ? <Spinner /> : null}
      <div className="space-y-1.5">
        {(consumables.data ?? []).map((consumable) => {
          const rule = ruleFor(consumable.id);
          return (
            <div key={consumable.id} className="flex items-center gap-2 text-sm">
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule !== undefined}
                  onChange={(e) => setRule(consumable.id, e.target.checked ? {} : null)}
                />
                <span className="truncate">
                  {consumable.name}{" "}
                  <span className="text-xs text-muted-foreground">({consumable.unit})</span>
                </span>
              </label>
              <Input
                type="number"
                min="0"
                step="any"
                className="w-20"
                aria-label={`Least ${consumable.name}`}
                placeholder="least"
                disabled={rule === undefined}
                value={rule?.minQuantity ?? ""}
                onChange={(e) =>
                  setRule(consumable.id, { minQuantity: Number(e.target.value) || 0 })
                }
              />
              <Input
                type="number"
                min="0"
                step="any"
                className="w-20"
                aria-label={`Most ${consumable.name}`}
                placeholder="most"
                disabled={rule === undefined}
                value={rule?.maxQuantity ?? ""}
                onChange={(e) =>
                  setRule(consumable.id, {
                    maxQuantity: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------ service kinds ------------------------------ */

function KindsTab() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [points, setPoints] = useState("0");

  const kinds = useQuery({
    queryKey: ["part-service-kinds", "all"],
    queryFn: () => fetchServiceKinds(),
  });
  // For naming a kind's rules on its row; the editor loads its own active list.
  const allConsumables = useQuery({
    queryKey: ["consumables", "all"],
    queryFn: () => fetchConsumables(),
  }).data;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["part-service-kinds"] });

  const create = useMutation({
    mutationFn: () => createServiceKind({ name, defaultPoints: Number(points) }),
    onSuccess: async () => {
      await invalidate();
      setName("");
      setPoints("0");
    },
  });
  const toggle = useMutation({
    mutationFn: (kind: ServiceKind) =>
      updateServiceKind(kind.id, { status: kind.status === "active" ? "inactive" : "active" }),
    onSuccess: invalidate,
  });

  return (
    <ExclusivePanels>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          What can be done to a part — Refill, Repair, whatever you call it — and what one is worth
          by default. <strong>Uses</strong> is where you say which consumables each one may take:
          set it and the service form offers only those, so a Refill can be toner and nothing else.
          A kind with no rules offers everything.
        </p>

        <Can permission={PERMISSIONS.PARTS_CONFIGURE}>
          <Card className="flex flex-wrap items-end gap-3 p-4">
            {create.error ? <ErrorAlert error={create.error} /> : null}
            <div className="min-w-40 flex-1">
              <Field label="Name">
                {(props) => (
                  <Input
                    {...props}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Refill"
                  />
                )}
              </Field>
            </div>
            <div className="w-32">
              <Field label="Default points">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min="0"
                    step="0.5"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Button
              size="sm"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              Add
            </Button>
          </Card>
        </Can>

        {kinds.isLoading ? <Spinner /> : null}
        {kinds.error ? <ErrorAlert error={kinds.error} /> : null}

        <ul className="divide-y divide-border rounded-lg border border-border">
          {(kinds.data ?? []).map((kind) => (
            <li key={kind.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {kind.name}{" "}
                    {kind.status === "inactive" ? (
                      <Badge tone="neutral">no longer offered</Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {kind.defaultPoints} points by default ·{" "}
                    {kind.consumables.length === 0
                      ? "offers every consumable — set Uses to narrow it"
                      : `uses ${consumableNames(kind.consumables, allConsumables)}`}
                  </p>
                </div>
                <Can permission={PERMISSIONS.PARTS_CONFIGURE}>
                  {/* `contents` rather than a box: an open editor panel is rendered by one
                    of these buttons, and inside a shrink-to-fit group its `w-full`
                    resolved against the group — which then claimed the row's width
                    and squeezed the name beside it into a column of single letters.
                    With the group's box gone the panel is a child of the wrapping
                    row, where `order-last` puts it on a line of its own beneath. */}
                  <div className="contents">
                    <KindDetailsEditor kind={kind} />
                    <KindConsumablesEditor kind={kind} />
                    <StatusButton
                      status={kind.status}
                      busy={toggle.isPending}
                      onToggle={() => toggle.mutate(kind)}
                    />
                  </div>
                </Can>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </ExclusivePanels>
  );
}

/** A service kind's own facts: its name and what it pays by default. */
function KindDetailsEditor({ kind }: { kind: ServiceKind }) {
  const queryClient = useQueryClient();
  const { open, setOpen } = useExclusivePanel(`${kind.id}:edit`);
  const [name, setName] = useState(kind.name);
  const [points, setPoints] = useState(String(kind.defaultPoints));

  const save = useMutation({
    mutationFn: () =>
      updateServiceKind(kind.id, { name: name.trim(), defaultPoints: Number(points) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["part-service-kinds"] });
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setName(kind.name);
          setPoints(String(kind.defaultPoints));
          setOpen(true);
        }}
      >
        Edit
      </Button>
    );
  }

  return (
    <Card className="order-last w-full space-y-2 p-3">
      {save.error ? <ErrorAlert error={save.error} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Points by default</span>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            className="h-8"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={save.isPending || name.trim() === ""}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

/** A consumable's own facts: its name and the unit it is measured in. */
function ConsumableDetailsEditor({ consumable }: { consumable: Consumable }) {
  const queryClient = useQueryClient();
  const { open, setOpen } = useExclusivePanel(`${consumable.id}:edit`);
  const [name, setName] = useState(consumable.name);
  const [unit, setUnit] = useState<ConsumableUnit>(consumable.unit);

  const save = useMutation({
    mutationFn: () => updateConsumable(consumable.id, { name: name.trim(), unit }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["consumables"] });
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setName(consumable.name);
          setUnit(consumable.unit);
          setOpen(true);
        }}
      >
        Edit
      </Button>
    );
  }

  return (
    <Card className="order-last w-full space-y-2 p-3">
      {save.error ? <ErrorAlert error={save.error} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Name</span>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Unit</span>
          {/* A fixed set, not free text: the unit is what every recorded quantity
              is counted in, and "g" and "grams" side by side would make the
              consumption report meaningless. */}
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value as ConsumableUnit)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs"
          >
            {CONSUMABLE_UNITS.map((option) => (
              <option key={option} value={option}>
                {CONSUMABLE_UNIT_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={save.isPending || name.trim() === ""}
          onClick={() => save.mutate()}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------- consumables ------------------------------- */

function ConsumablesTab() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<ConsumableUnit>("ea");

  const consumables = useQuery({
    queryKey: ["consumables", "all"],
    queryFn: () => fetchConsumables(),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["consumables"] });

  const create = useMutation({
    mutationFn: () => createConsumable({ name, unit }),
    onSuccess: async () => {
      await invalidate();
      setName("");
    },
  });
  const toggle = useMutation({
    mutationFn: (consumable: Consumable) =>
      updateConsumable(consumable.id, {
        status: consumable.status === "active" ? "inactive" : "active",
      }),
    onSuccess: invalidate,
  });

  return (
    <ExclusivePanels>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          What gets used up: toner powder, drums, blades, chips. A list of names and their unit, and
          nothing else — there are no stock levels anywhere in this module, because it records what
          a job consumed rather than what is left in the cupboard.
        </p>

        <Can permission={PERMISSIONS.PARTS_CONFIGURE}>
          <Card className="flex flex-wrap items-end gap-3 p-4">
            {create.error ? <ErrorAlert error={create.error} /> : null}
            <div className="min-w-40 flex-1">
              <Field label="Name">
                {(props) => (
                  <Input
                    {...props}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Toner powder"
                  />
                )}
              </Field>
            </div>
            <div className="w-40">
              <Field label="Counted in">
                {(props) => (
                  <Select
                    {...props}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as ConsumableUnit)}
                  >
                    {CONSUMABLE_UNITS.map((value) => (
                      <option key={value} value={value}>
                        {CONSUMABLE_UNIT_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Button
              size="sm"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              Add
            </Button>
          </Card>
        </Can>

        {consumables.isLoading ? <Spinner /> : null}
        {consumables.error ? <ErrorAlert error={consumables.error} /> : null}

        <ul className="divide-y divide-border rounded-lg border border-border">
          {(consumables.data ?? []).map((consumable) => (
            <li key={consumable.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {consumable.name}{" "}
                  {consumable.status === "inactive" ? (
                    <Badge tone="neutral">no longer offered</Badge>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  counted in {CONSUMABLE_UNIT_LABELS[consumable.unit]}
                </p>
              </div>
              <Can permission={PERMISSIONS.PARTS_CONFIGURE}>
                {/* `contents` rather than a box: an open editor panel is rendered by one
                    of these buttons, and inside a shrink-to-fit group its `w-full`
                    resolved against the group — which then claimed the row's width
                    and squeezed the name beside it into a column of single letters.
                    With the group's box gone the panel is a child of the wrapping
                    row, where `order-last` puts it on a line of its own beneath. */}
                <div className="contents">
                  <ConsumableDetailsEditor consumable={consumable} />
                  <StatusButton
                    status={consumable.status}
                    busy={toggle.isPending}
                    onToggle={() => toggle.mutate(consumable)}
                  />
                </div>
              </Can>
            </li>
          ))}
        </ul>
      </div>
    </ExclusivePanels>
  );
}

export function CartridgeSetupPage({ tab }: { tab: string }) {
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Cartridge setup"
        description="The vocabulary this module runs on. It is all data, not code — a company tracking something other than cartridges fills in different words here and everything else behaves the same."
      />
      <PageTabs
        tabs={TABS}
        active={tab}
        onSelect={(id) => void navigate({ to: "/cartridges/setup", search: { tab: id } })}
      />
      <TabPanel id="models" active={tab}>
        <ModelsTab />
      </TabPanel>
      <TabPanel id="kinds" active={tab}>
        <KindsTab />
      </TabPanel>
      <TabPanel id="consumables" active={tab}>
        <ConsumablesTab />
      </TabPanel>
    </>
  );
}
