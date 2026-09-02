// Author: Brijesh Dave <https://github.com/brijeshdave>
// One cartridge: where it is, what has been done to it, and the one move it can
// make next.
//
// The actions are driven by the part's status rather than all shown and half
// disabled. A disabled button invites the question "why not"; an absent one says
// the same thing without asking anybody to hover over it. The API refuses the
// same transitions regardless — this is convenience, not enforcement.
import {
  CONSUMABLE_UNIT_LABELS,
  PART_STATUS_LABELS,
  PERMISSIONS,
  formatDateTime,
  meanPages,
  pagesFor,
  yieldPercent,
  type Consumable,
  PART_EVENT_KINDS,
  PART_EVENT_LABELS,
  type Part,
  type PartEvent,
  type PartEventKind,
  type PartStatus,
  type ServiceKind,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, PackageCheck, PackageX, Undo2, Wrench } from "lucide-react";
import { useState } from "react";

import { Can } from "@/components/can.js";
import { ConfirmDialog } from "@/components/confirm-dialog.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { SearchableSelect } from "@/components/searchable-select.js";
import { Field, Input, Select, Spinner, Textarea } from "@/components/ui/form.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";

import { fetchLocations } from "@/services/locations.js";
import {
  deployPart,
  fetchConsumables,
  fetchPart,
  fetchPartModel,
  fetchPartTimeline,
  fetchFittingDevices,
  fetchServiceKinds,
  recordService,
  restockPart,
  updatePart,
  returnPart,
  scrapPart,
} from "@/services/parts.js";

const STATUS_TONE: Record<PartStatus, "success" | "info" | "warning" | "neutral"> = {
  needs_service: "warning",
  ready: "success",
  installed: "info",
  scrapped: "neutral",
};

/**
 * What one tour printed, in words.
 *
 * Three different sentences for three different situations, because "we never
 * measured it" and "the counter was reset" send a reader to fix different
 * things, and a screen that shows the same dash for both tells them neither.
 */
function TourPages({
  tour,
  rated,
}: {
  tour: { meterStart: number | null; meterEnd: number | null; pagesPrinted: number | null };
  rated: number | null;
}) {
  const count = pagesFor(tour);
  if (count.pages === null) {
    return (
      <span className="text-muted-foreground">
        {count.from === "meter-reset" ? "meter reset — pages unknown" : "pages not recorded"}
      </span>
    );
  }

  const percent = yieldPercent(count.pages, rated);
  return (
    <span>
      <span className="tabular-nums">{count.pages.toLocaleString()}</span> pages
      {percent !== null ? (
        // Under half its rating is worth the eye catching, and nothing more: the
        // number measures what people printed as much as it measures the refill.
        <span className={percent < 50 ? "text-warning" : "text-muted-foreground"}>
          {" "}
          · {percent}% of rated
        </span>
      ) : null}
    </span>
  );
}

/* --------------------------------- actions -------------------------------- */

function DeployForm({ part, onDone }: { part: Part; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState("");
  const [note, setNote] = useState("");
  const [meterStart, setMeterStart] = useState("");
  // Only the machines this model fits. Asked of the server, which is the same
  // place that refuses an incompatible deploy — a second copy of the rule in the
  // browser is one that can disagree with it.
  const devices = useQuery({
    queryKey: ["parts", part.id, "fitting-devices"],
    queryFn: () => fetchFittingDevices(part.id),
  });

  const deploy = useMutation({
    mutationFn: () =>
      deployPart(part.id, {
        deviceId,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(meterStart.trim() ? { meterStart: Number(meterStart) } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["parts"] });
      onDone();
    },
  });

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">Install on a printer</h2>
      {deploy.error ? <ErrorAlert error={deploy.error} /> : null}
      <Field label="Printer" hint={`Only machines ${part.partModelName} fits are listed.`}>
        {(props) => (
          <SearchableSelect
            {...props}
            value={deviceId}
            onChange={setDeviceId}
            // The type goes underneath rather than trailing the name: a floor of
            // fifty printers is a list to search, not to read.
            options={(devices.data ?? []).map((device) => ({
              value: device.id,
              label: device.name,
              hint: device.typeName ?? undefined,
            }))}
            placeholder="Choose…"
          />
        )}
      </Field>
      {!devices.isLoading && (devices.data ?? []).length === 0 ? (
        // The honest answer to an empty picker. Without it this reads as a
        // broken dropdown, when it is really a model that fits nothing yet or a
        // company with no machine of a type it fits.
        <p className="text-xs text-muted-foreground">
          No machine here takes a {part.partModelName}. Either its model fits no device type yet —
          set that with <strong>Fits</strong> under{" "}
          <Link to="/cartridges/setup" className="text-primary hover:underline">
            Cartridge setup
          </Link>{" "}
          — or no device of a fitting type has been registered.
        </p>
      ) : null}
      <Field
        label="Printer's page counter"
        hint="Optional. What the machine reads right now — the other half of it is taken when the part comes back out, and the pages are the difference."
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            min="0"
            inputMode="numeric"
            className="w-40"
            value={meterStart}
            onChange={(e) => setMeterStart(e.target.value)}
          />
        )}
      </Field>
      <Field label="Note" hint="Optional.">
        {(props) => <Input {...props} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={!deviceId || deploy.isPending} onClick={() => deploy.mutate()}>
          Install
        </Button>
      </div>
    </Card>
  );
}

function ReturnForm({
  part,
  openTour,
  onDone,
}: {
  part: Part;
  /** The install being closed, so the form can ask for the half that completes it. */
  openTour: PartEvent | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<"ok" | "faulty">("ok");
  const [note, setNote] = useState("");
  const [pages, setPages] = useState("");
  const [reversed, setReversed] = useState<boolean | null>(null);

  // A reading was taken when it went in, so the matching one closes the pair.
  // Where there was none, one number is asked for outright — offering both boxes
  // would be two ways to say the same thing and a reader deciding which we meant.
  const metered = openTour?.meterStart !== null && openTour?.meterStart !== undefined;

  const book = useMutation({
    mutationFn: () =>
      returnPart(part.id, {
        outcome,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(pages.trim()
          ? metered
            ? { meterEnd: Number(pages) }
            : { pagesPrinted: Number(pages) }
          : {}),
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["parts"] });
      // Said here rather than left for a leaderboard next week. If nothing was
      // reversed the form simply closes: there is no news in "nothing happened".
      if (result.pointsReversed) setReversed(true);
      else onDone();
    },
  });

  if (reversed) {
    return (
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-semibold">Points taken back</h2>
        <p className="text-sm text-muted-foreground">
          This cartridge failed inside the company&rsquo;s window, so the points for the service
          before it were reversed. The award and its reversal both stay in the ledger — nothing was
          deleted.
        </p>
        <div className="flex justify-end">
          <Button size="sm" onClick={onDone}>
            Understood
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">Book back into the workshop</h2>
      {book.error ? <ErrorAlert error={book.error} /> : null}
      <Field
        label="How did it end?"
        hint="Faulty is a decision, not a note: inside the failure window it reverses the points for the service before this one."
      >
        {(props) => (
          <Select
            {...props}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as "ok" | "faulty")}
          >
            <option value="ok">Worked — came off for the usual reason</option>
            <option value="faulty">Faulty — it did not work properly</option>
          </Select>
        )}
      </Field>
      <Field
        label={metered ? "Printer's page counter" : "Pages printed this tour"}
        hint={
          metered
            ? `Optional. It read ${openTour!.meterStart!.toLocaleString()} when this cartridge went in — the difference is what it printed.`
            : "Optional. No counter was read when it went in, so this is the whole number."
        }
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            min="0"
            inputMode="numeric"
            className="w-40"
            value={pages}
            onChange={(e) => setPages(e.target.value)}
          />
        )}
      </Field>
      <Field label="Note" hint="Optional. What went wrong, if anything.">
        {(props) => (
          <Textarea {...props} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={book.isPending} onClick={() => book.mutate()}>
          Book in
        </Button>
      </div>
    </Card>
  );
}

function ServiceForm({
  part,
  kinds,
  consumables,
  onDone,
}: {
  part: Part;
  kinds: ServiceKind[];
  consumables: Consumable[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [serviceKindId, setServiceKindId] = useState(kinds[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [used, setUsed] = useState<Record<string, string>>({});

  const kind = kinds.find((candidate) => candidate.id === serviceKindId);
  // What this kind may consume. No rules at all means unrestricted, which is how
  // every kind behaved before the rules existed.
  const rules = kind?.consumables ?? [];
  const offered =
    rules.length === 0
      ? consumables
      : consumables.filter((consumable) =>
          rules.some((rule) => rule.consumableId === consumable.id),
        );
  const ruleFor = (consumableId: string) =>
    rules.find((rule) => rule.consumableId === consumableId);

  const save = useMutation({
    mutationFn: () =>
      recordService(part.id, {
        serviceKindId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        consumptions: Object.entries(used)
          .map(([consumableId, quantity]) => ({ consumableId, quantity: Number(quantity) }))
          // A blank or zero box means "did not use it", which is not a line.
          .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["parts"] });
      onDone();
    },
  });

  return (
    <Card className="space-y-3 p-4">
      <h2 className="text-sm font-semibold">Record a refill or repair</h2>
      {/* What it pays is not asked for here: the rate comes from the model and the
          kind on the server, so the screen cannot promise a number the ledger
          then disagrees with. */}
      {save.error ? <ErrorAlert error={save.error} /> : null}
      <Field label="What was done">
        {(props) => (
          <Select
            {...props}
            value={serviceKindId}
            onChange={(e) => {
              setServiceKindId(e.target.value);
              // Clear what was typed: a quantity entered against a consumable
              // the new kind does not use would be submitted invisibly and
              // refused, with nothing on screen explaining why.
              setUsed({});
            }}
          >
            {kinds.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What it used</legend>
        <p className="text-xs text-muted-foreground">
          {rules.length === 0
            ? "Recorded against the job. Leave a box empty for anything you did not use — this is a record of work, not a stock cupboard."
            : `Only what a ${kind?.name.toLowerCase()} uses is listed. Recorded against the job, not deducted from a cupboard.`}
        </p>
        {offered.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            A {kind?.name.toLowerCase()} uses no consumables — record it on its own.
          </p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {offered.map((consumable) => {
            const rule = ruleFor(consumable.id);
            const required = (rule?.minQuantity ?? 0) > 0;
            return (
              <label key={consumable.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">
                  {consumable.name}
                  {required ? <span className="ml-1 text-destructive">*</span> : null}
                  {rule && (rule.minQuantity > 0 || rule.maxQuantity !== null) ? (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {rule.maxQuantity !== null
                        ? `${rule.minQuantity}–${rule.maxQuantity}`
                        : `min ${rule.minQuantity}`}
                    </span>
                  ) : null}
                </span>
                <Input
                  type="number"
                  min={rule?.minQuantity ?? 0}
                  max={rule?.maxQuantity ?? undefined}
                  step="any"
                  inputMode="decimal"
                  aria-label={`${consumable.name} used, in ${CONSUMABLE_UNIT_LABELS[consumable.unit]}`}
                  className="w-24"
                  value={used[consumable.id] ?? ""}
                  onChange={(e) => setUsed({ ...used, [consumable.id]: e.target.value })}
                />
                <span className="w-8 text-xs text-muted-foreground">{consumable.unit}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <Field label="Notes" hint="Optional.">
        {(props) => (
          <Textarea {...props} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={!serviceKindId || save.isPending} onClick={() => save.mutate()}>
          Record
        </Button>
      </div>
    </Card>
  );
}

/**
 * Everything that has happened to this cartridge, in one sequence.
 *
 * Two lists side by side — what was done to it, and where it had been — read
 * fine and analysed badly: "was it refilled before or after that printer chewed
 * it?" is a question about one sequence, and two lists make the reader interleave
 * them by eye.
 */
function Timeline({ events, rated }: { events: PartEvent[]; rated: number | null }) {
  const [kind, setKind] = useState<PartEventKind | "all">("all");
  const [device, setDevice] = useState("all");

  const devices = [...new Set(events.map((e) => e.deviceName).filter((n): n is string => !!n))];
  const shown = events.filter(
    (event) =>
      (kind === "all" || event.kind === kind) && (device === "all" || event.deviceName === device),
  );

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">History</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">
            <span className="sr-only">Filter by event</span>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as PartEventKind | "all")}
              aria-label="Filter by event"
              className="h-8"
            >
              <option value="all">Everything</option>
              {PART_EVENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {PART_EVENT_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
          {/* Only offered once the part has been in more than one machine —
              a filter with a single choice is furniture. */}
          {devices.length > 1 ? (
            <label className="text-xs text-muted-foreground">
              <span className="sr-only">Filter by printer</span>
              <Select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                aria-label="Filter by printer"
                className="h-8"
              >
                <option value="all">Any printer</option>
                {devices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {events.length === 0 ? "Nothing has happened to it yet." : "Nothing matches that filter."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Event</th>
                <th className="py-2 pr-3 font-medium">What happened</th>
                <th className="py-2 font-medium">Who</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((event) => (
                <tr key={event.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(event.at)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    <Badge tone={EVENT_TONE[event.kind]}>{PART_EVENT_LABELS[event.kind]}</Badge>
                  </td>
                  <td className="py-2 pr-3">
                    <EventDetail event={event} rated={rated} />
                  </td>
                  <td className="whitespace-nowrap py-2 text-xs text-muted-foreground">
                    {event.actorName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const EVENT_TONE: Record<PartEventKind, "success" | "info" | "warning" | "neutral"> = {
  registered: "neutral",
  installed: "info",
  removed: "warning",
  serviced: "success",
};

/** One row's worth of words, which differ entirely by what kind of event it is. */
function EventDetail({ event, rated }: { event: PartEvent; rated: number | null }) {
  if (event.kind === "registered") {
    return <span className="text-muted-foreground">Added to the register.</span>;
  }

  if (event.kind === "installed") {
    return (
      <span>
        Into <strong>{event.deviceName}</strong>
        {event.meterStart !== null ? (
          <span className="text-muted-foreground">
            {" "}
            · counter {event.meterStart.toLocaleString()}
          </span>
        ) : null}
        {event.note ? (
          <span className="block text-xs text-muted-foreground">{event.note}</span>
        ) : null}
      </span>
    );
  }

  if (event.kind === "removed") {
    return (
      <span>
        Out of <strong>{event.deviceName}</strong>
        {event.outcome ? (
          <span className={event.outcome === "faulty" ? " text-destructive" : ""}>
            {" "}
            · {event.outcome === "faulty" ? "faulty" : "worked"}
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {" "}
          · <TourPages tour={event} rated={rated} />
        </span>
        {event.note ? (
          <span className="block text-xs text-muted-foreground">{event.note}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span>
      <strong>{event.serviceKindName}</strong>
      {event.points !== null ? (
        <span className="text-muted-foreground"> · {event.points} pts</span>
      ) : null}
      {event.pointsReversedAt ? (
        <span className="text-destructive"> · reversed — came back faulty</span>
      ) : null}
      {event.consumptions.length > 0 ? (
        <span className="block text-xs text-muted-foreground">
          Used:{" "}
          {event.consumptions
            .map((line) => `${line.consumableName} ${line.quantity}${line.unit}`)
            .join(", ")}
        </span>
      ) : null}
      {event.note ? (
        <span className="block text-xs text-muted-foreground">{event.note}</span>
      ) : null}
    </span>
  );
}

/* --------------------------------- the page -------------------------------- */

type OpenForm = "deploy" | "return" | "service" | null;

export function PartDetailPage({ partId }: { partId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<OpenForm>(null);
  const [confirmScrap, setConfirmScrap] = useState(false);

  const part = useQuery({ queryKey: ["parts", partId], queryFn: () => fetchPart(partId) });
  const timeline = useQuery({
    queryKey: ["parts", partId, "timeline"],
    queryFn: () => fetchPartTimeline(partId),
  });
  const model = useQuery({
    queryKey: ["part-models", part.data?.partModelId],
    queryFn: () => fetchPartModel(part.data!.partModelId),
    enabled: Boolean(part.data),
  });
  const kinds = useQuery({
    queryKey: ["part-service-kinds", "active"],
    queryFn: () => fetchServiceKinds(true),
  });
  const consumables = useQuery({
    queryKey: ["consumables", "active"],
    queryFn: () => fetchConsumables(true),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["parts"] });
  };

  /**
   * Put it back on a shelf — and say which shelf.
   *
   * The site decides who can see the cartridge at all, and this was the only place
   * that could set one without installing it: the call took a location and the
   * button never passed one, so every cartridge stayed unplaced and visible to
   * everybody. Defaults to where it already is, then to the person's own site when
   * they have exactly one.
   */
  const sites = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const activeSites = (sites.data ?? []).filter((site) => site.status === "active");
  /**
   * Move it to another shelf, or off one.
   *
   * Saved the moment it is chosen: this is one field with no other state around
   * it, so a Save button would only be a second click to forget.
   */
  const move = useMutation({
    mutationFn: (locationId: string | null) => updatePart(partId, { locationId }),
    onSuccess: invalidate,
  });

  const restock = useMutation({
    // Keeps the shelf it is already on; the Site control changes that.
    mutationFn: () => {
      return restockPart(partId, p?.locationId ?? null);
    },
    onSuccess: invalidate,
  });
  const scrap = useMutation({
    mutationFn: () => scrapPart(partId),
    onSuccess: async () => {
      await invalidate();
      setConfirmScrap(false);
    },
  });

  if (part.isLoading) return <Spinner />;
  if (part.error) return <ErrorAlert error={part.error} />;
  if (!part.data) return null;
  const p = part.data;

  const events = timeline.data ?? [];
  // The tour it is on now: the latest install with no removal after it.
  const openTour =
    p.status === "installed" ? (events.find((event) => event.kind === "installed") ?? null) : null;
  const rated = model.data?.ratedPageYield ?? null;
  // Computed from the timeline already on screen rather than served with the
  // part: the register lists hundreds, and a mean that cost a query each would be
  // paid for on every page load by everybody who never looks at it.
  const mean = meanPages(events.filter((event) => event.kind === "removed"));

  return (
    <>
      <PageHeader
        title={p.identifier}
        description={[
          p.partModelName,
          `${p.cycleCount} ${p.cycleCount === 1 ? "cycle" : "cycles"}`,
          ...(p.overCycleLimit ? ["past its rated cycles"] : []),
          ...(mean !== null ? [`${mean.toLocaleString()} pages a tour on average`] : []),
          ...(rated !== null ? [`rated ${rated.toLocaleString()}`] : []),
        ].join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void navigate({ to: "/cartridges" })}
            >
              <ArrowLeft className="h-4 w-4" />
              All cartridges
            </Button>

            {p.status === "ready" ? (
              <>
                <Can permission={PERMISSIONS.PARTS_DEPLOY}>
                  <Button size="sm" onClick={() => setForm("deploy")}>
                    <PackageCheck className="h-4 w-4" />
                    Install
                  </Button>
                </Can>
                {/* Servicing one already ready is somebody's business, not ours —
                    a top-up before it goes out is a real thing to record. */}
                <Can permission={PERMISSIONS.PARTS_SERVICE}>
                  <Button variant="secondary" size="sm" onClick={() => setForm("service")}>
                    <Wrench className="h-4 w-4" />
                    Service
                  </Button>
                </Can>
              </>
            ) : null}

            {p.status === "installed" ? (
              <Can permission={PERMISSIONS.PARTS_DEPLOY}>
                <Button size="sm" onClick={() => setForm("return")}>
                  <Undo2 className="h-4 w-4" />
                  Book in
                </Button>
              </Can>
            ) : null}

            {p.status === "needs_service" ? (
              <>
                <Can permission={PERMISSIONS.PARTS_SERVICE}>
                  <Button size="sm" onClick={() => setForm("service")}>
                    <Wrench className="h-4 w-4" />
                    Service
                  </Button>
                </Can>
                {/* For one that came off working and needs nothing. Forcing a
                    service event to move it would put points in the ledger for
                    work nobody did. */}
                <Can permission={PERMISSIONS.PARTS_DEPLOY}>
                  {/* No site picker here: the Site control below sets it, for any
                      cartridge that is not in a machine. Two of them on one screen
                      asked the same question twice. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={restock.isPending}
                    onClick={() => restock.mutate()}
                  >
                    Mark ready
                  </Button>
                </Can>
              </>
            ) : null}

            {p.status !== "scrapped" && p.status !== "installed" ? (
              <Can permission={PERMISSIONS.PARTS_MANAGE}>
                <Button variant="destructive" size="sm" onClick={() => setConfirmScrap(true)}>
                  <PackageX className="h-4 w-4" />
                  Scrap
                </Button>
              </Can>
            ) : null}
          </div>
        }
      />

      {restock.error ? <ErrorAlert error={restock.error} /> : null}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={STATUS_TONE[p.status]}>{PART_STATUS_LABELS[p.status]}</Badge>
        <span className="text-muted-foreground">
          {p.deviceName ? `In ${p.deviceName}` : p.locationName ? `At ${p.locationName}` : "—"}
        </span>

        {/* Change where it is kept.
            The site decides who can see the cartridge, and until now the only ways
            to set one were registering a new cartridge or booking one back in from
            service — so a register full of ready cartridges had no path at all, and
            every one of them read "Not placed" for ever. Hidden while installed:
            the placement already says where it is, and a second answer beside it
            would contradict the first. */}
        {p.status !== "installed" && p.status !== "scrapped" ? (
          <Can permission={PERMISSIONS.PARTS_MANAGE}>
            <Select
              aria-label="Site"
              className="h-8 w-44"
              value={p.locationId ?? ""}
              disabled={move.isPending}
              onChange={(event) => move.mutate(event.target.value || null)}
            >
              <option value="">Not placed</option>
              {activeSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </Select>
          </Can>
        ) : null}
      </div>

      {move.error ? <ErrorAlert error={move.error} /> : null}

      {p.notes ? <Card className="p-3 text-sm">{p.notes}</Card> : null}

      {form === "deploy" ? <DeployForm part={p} onDone={() => setForm(null)} /> : null}
      {form === "return" ? (
        <ReturnForm part={p} openTour={openTour} onDone={() => setForm(null)} />
      ) : null}
      {form === "service" ? (
        kinds.data && kinds.data.length > 0 ? (
          <ServiceForm
            part={p}
            kinds={kinds.data}
            consumables={consumables.data ?? []}
            onDone={() => setForm(null)}
          />
        ) : (
          <Card className="p-4 text-sm text-muted-foreground">
            No service kinds yet — add Refill or Repair in Cartridge setup first.
          </Card>
        )
      ) : null}

      <Timeline events={timeline.data ?? []} rated={rated} />

      <ConfirmDialog
        open={confirmScrap}
        title="Scrap this cartridge?"
        description="It keeps its place in the register and all of its history, but it can never go out again."
        confirmLabel="Scrap"
        destructive
        onConfirm={() => scrap.mutateAsync()}
        onClose={() => setConfirmScrap(false)}
      />
    </>
  );
}
