// Author: Brijesh Dave <https://github.com/brijeshdave>
// The cartridge register: every part, where it is, and how many times it has been
// round.
//
// A table on the platform's own terms — the server pages, sorts and filters it,
// as it does for devices and users. This started as a grid of cards, which reads
// well at a dozen parts and stops working at three hundred: the questions people
// actually arrive with are "what is waiting in the workshop" and "which of these
// is past its cycles", and both are filters rather than a scroll.
import {
  PART_STATUSES,
  PART_STATUS_LABELS,
  PERMISSIONS,
  type Part,
  type PartModel,
  type PartStatus,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/components/can.js";
import { DataTable, type TableColumn } from "@/components/data-table/data-table.js";
import type { FilterDef } from "@/components/data-table/filter-sidebar.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Field, Input, Select, Textarea } from "@/components/ui/form.js";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives.js";
import { useListResource } from "@/hooks/use-list-resource.js";
import { sessionQuery } from "@/lib/queries.js";
import { createPart, fetchPartModels } from "@/services/parts.js";

const STATUS_TONE: Record<PartStatus, "success" | "info" | "warning" | "neutral"> = {
  needs_service: "warning",
  ready: "success",
  installed: "info",
  scrapped: "neutral",
};

const columns: TableColumn<Part>[] = [
  {
    id: "identifier",
    accessorKey: "identifier",
    header: "Cartridge",
    cell: ({ row }) => (
      <Link
        to="/cartridges/$partId"
        params={{ partId: row.original.id }}
        className="font-mono text-sm font-medium text-foreground hover:underline"
      >
        {row.original.identifier}
      </Link>
    ),
  },
  {
    id: "partModelName",
    accessorKey: "partModelName",
    header: "Model",
    // Not sortable: the column is the model's name, joined in, while the server
    // sorts on the part's own columns. A header that sorts by something else
    // than it shows is worse than one that does not sort.
    enableSorting: false,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge tone={STATUS_TONE[row.original.status]}>
        {PART_STATUS_LABELS[row.original.status]}
      </Badge>
    ),
  },
  {
    id: "where",
    accessorKey: "deviceName",
    header: "Where",
    enableSorting: false,
    cell: ({ row }) =>
      row.original.deviceName ??
      row.original.locationName ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "cycleCount",
    accessorKey: "cycleCount",
    header: "Cycles",
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.cycleCount}
        {/* Advisory, never a block: the maker's figure is an opinion and the
            technician holding the part has better information. */}
        {row.original.overCycleLimit ? (
          <span className="ml-1.5 text-xs text-warning">over limit</span>
        ) : null}
      </span>
    ),
  },
];

function RegisterForm({ models, onClose }: { models: PartModel[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [partModelId, setPartModelId] = useState(models[0]?.id ?? "");
  const [status, setStatus] = useState<"needs_service" | "ready">("needs_service");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createPart({
        identifier,
        partModelId,
        status,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["parts"] });
      onClose();
    },
  });

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">Register a cartridge</h2>
      {create.error ? <ErrorAlert error={create.error} /> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Identifier" hint="The label your team writes on it. Unique here.">
          {(props) => (
            <Input
              {...props}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="TN-0042"
            />
          )}
        </Field>
        <Field label="Model">
          {(props) => (
            <Select {...props} value={partModelId} onChange={(e) => setPartModelId(e.target.value)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field
        label="Is it usable now?"
        hint="A new cartridge from the supplier is ready to go out. One collected from a printer for refilling is not, and only a ready one can be installed."
      >
        {(props) => (
          <Select
            {...props}
            value={status}
            onChange={(e) => setStatus(e.target.value as "needs_service" | "ready")}
          >
            <option value="needs_service">Needs service — refill or repair it first</option>
            <option value="ready">Ready — full and deployable</option>
          </Select>
        )}
      </Field>
      <Field label="Notes" hint="Optional.">
        {(props) => (
          <Textarea {...props} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!identifier.trim() || !partModelId || create.isPending}
          onClick={() => create.mutate()}
        >
          Register
        </Button>
      </div>
    </Card>
  );
}

export function CartridgesListPage() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const [registering, setRegistering] = useState(false);

  const models = useQuery({
    queryKey: ["part-models", "active"],
    queryFn: () => fetchPartModels(true),
  });
  const list = useListResource<Part>({
    resource: "parts",
    path: "/parts",
    initial: { sortBy: "identifier", sortDir: "asc" },
  });

  // Filters offered by name rather than raw id where the API takes an id: the
  // model list is short and a person filters by "HP 12A", not by a uuid.
  const filterDefs: FilterDef[] = [
    { field: "identifier", label: "Cartridge", kind: "text" },
    {
      field: "status",
      label: "Status",
      kind: "select",
      options: PART_STATUSES.map((status) => ({
        value: status,
        label: PART_STATUS_LABELS[status],
      })),
    },
    {
      field: "partModelId",
      label: "Model",
      kind: "select",
      options: (models.data ?? []).map((model) => ({ value: model.id, label: model.name })),
    },
  ];

  if (!session.companyId) {
    return (
      <>
        <PageHeader title="Cartridges" description="Printer cartridges and other rotables." />
        <EmptyState
          icon={Building2}
          title="Pick a company first"
          description="Choose a company in the top-bar switcher to see its cartridges."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Cartridges"
        description="Every cartridge you refill or repair, where it is now, and how many times it has been round. A part is in one machine at a time — the register says which."
        actions={
          <Can permission={PERMISSIONS.PARTS_MANAGE}>
            <Button size="sm" onClick={() => setRegistering(true)}>
              <Plus className="h-4 w-4" />
              Register
            </Button>
          </Can>
        }
      />

      {registering ? (
        models.data && models.data.length > 0 ? (
          <RegisterForm models={models.data} onClose={() => setRegistering(false)} />
        ) : (
          // A part must have a model: the model is what says which printers it
          // fits, and without that a deploy has nothing to check.
          <Card className="p-4 text-sm text-muted-foreground">
            Add a cartridge model first — it is what says which printers a part fits.{" "}
            <Link to="/cartridges/setup" className="text-primary hover:underline">
              Cartridge setup
            </Link>
          </Card>
        )
      ) : null}

      <DataTable
        {...list}
        columns={columns}
        filterDefs={filterDefs}
        emptyTitle="No cartridges yet"
        emptyDescription="Register the cartridges your team refills, and they will appear here."
        renderCard={(part) => (
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/cartridges/$partId"
              params={{ partId: part.id }}
              className="truncate font-mono text-sm font-medium hover:underline"
            >
              {part.identifier}
            </Link>
            <Badge tone={STATUS_TONE[part.status]}>{PART_STATUS_LABELS[part.status]}</Badge>
          </div>
        )}
      />
    </>
  );
}
