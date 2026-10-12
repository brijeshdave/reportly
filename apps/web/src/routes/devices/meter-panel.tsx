// Author: Brijesh Dave <https://github.com/brijeshdave>
// A printer's page counter: every reading, and a way to add one.
//
// The counter belongs to the machine, so this is the one place its whole series
// can be read. It matters most for the resets. A reset is the only legitimate way
// for the series to go backwards, and recording one is how the page-count reports
// know not to treat the drop as pages printed — so being able to see where the
// breaks are, and who declared them, is how a wrong one gets found. A printer
// showing several in a month has not been replaced several times; somebody has
// been reading the wrong number and waving the question away.
//
// Readings taken on a round live here too, rather than only at a cartridge swap:
// between two swaps a machine may print for months, and its output over any
// shorter period cannot be worked out from swap readings alone.
import { PERMISSIONS, formatDateTime, recordMeterReadingSchema } from "@reportly/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Can } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { Badge, Button, Card } from "@/components/ui/primitives.js";
import { useForm } from "@/hooks/use-form.js";
import { fetchDeviceMeter, recordMeterReading } from "@/services/parts.js";

/** What each kind of reading is called, and how loudly. */
const SOURCE: Record<string, { label: string; tone: "neutral" | "brand" | "warning" }> = {
  install: { label: "Cartridge in", tone: "neutral" },
  removal: { label: "Cartridge out", tone: "neutral" },
  manual: { label: "Read on a round", tone: "brand" },
  reset: { label: "Counter reset", tone: "warning" },
};

export function MeterPanel({ deviceId }: { deviceId: string }) {
  const queryClient = useQueryClient();
  const meter = useQuery({
    queryKey: ["devices", deviceId, "meter"],
    queryFn: () => fetchDeviceMeter(deviceId),
  });

  const readings = meter.data?.readings ?? [];
  const last = meter.data?.last ?? null;
  const resets = readings.filter((r) => r.source === "reset").length;

  const form = useForm({
    schema: recordMeterReadingSchema.pick({ pages: true, note: true }),
    initial: { pages: "", note: "" },
    toPayload: (v) => ({
      // Blank must stay blank rather than becoming nought: `Number("")` is 0, and
      // a counter reading of zero is a claim, not an empty box.
      pages: v.pages.trim() === "" ? NaN : Number(v.pages),
      ...(v.note.trim() ? { note: v.note.trim() } : {}),
    }),
    submit: (input) => recordMeterReading(deviceId, input as { pages: number; note?: string }),
    onSuccess: async () => {
      form.reset({ pages: "", note: "" });
      await queryClient.invalidateQueries({ queryKey: ["devices", deviceId, "meter"] });
    },
  });

  if (meter.isLoading) return <Spinner />;
  // Not an error state: a company that does not use the cartridge module has no
  // meter endpoint at all, and this panel simply does not apply to it.
  if (meter.error) return null;

  return (
    <Card className="mt-4 max-w-lg p-6">
      <h2 className="text-sm font-semibold">Page counter</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        What this machine has read, and when. Cartridge page counts are the gaps between these, so a
        wrong reading here is a wrong figure in every report.
      </p>

      {last ? (
        <p className="mt-3 text-sm">
          Last read <strong>{last.pages.toLocaleString()}</strong> on {formatDateTime(last.readAt)}.
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Never read.</p>
      )}

      {/* The thing worth noticing without being asked. One is a replaced machine;
          several in a row is somebody reading the wrong line of the display. */}
      {resets > 1 ? (
        <Alert tone="warning" className="mt-3">
          The counter has been declared reset {resets} times. A printer is replaced rarely — more
          often this means a reading was taken from the wrong number and the question was waved
          away.
        </Alert>
      ) : null}

      <Can permission={PERMISSIONS.PARTS_DEPLOY}>
        <form {...form.formProps} className="mt-4 flex flex-wrap items-end gap-3">
          {form.formError ? <ErrorAlert error={form.formError} /> : null}
          <div className="w-40">
            <Field label="Reading now" error={form.errorFor("pages")}>
              {(props) => <Input {...props} type="number" min="0" {...form.register("pages")} />}
            </Field>
          </div>
          <div className="min-w-40 flex-1">
            <Field label="Note" error={form.errorFor("note")}>
              {(props) => <Input {...props} {...form.register("note")} placeholder="Optional" />}
            </Field>
          </div>
          <Button type="submit" size="sm" disabled={form.submitting}>
            {form.submitting ? <Spinner /> : null}
            Record
          </Button>
        </form>
      </Can>

      {readings.length === 0 ? null : (
        <ul className="mt-4 divide-y divide-border border-t border-border">
          {[...readings].reverse().map((reading) => {
            const kind = SOURCE[reading.source] ?? { label: reading.source, tone: "neutral" };
            return (
              <li key={reading.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="w-24 font-medium tabular-nums">
                  {reading.pages.toLocaleString()}
                </span>
                <Badge tone={kind.tone}>{kind.label}</Badge>
                <span className="text-muted-foreground">{formatDateTime(reading.readAt)}</span>
                {reading.readByName ? (
                  <span className="text-muted-foreground">· {reading.readByName}</span>
                ) : null}
                {reading.note ? (
                  <span className="w-full text-xs text-muted-foreground">{reading.note}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
