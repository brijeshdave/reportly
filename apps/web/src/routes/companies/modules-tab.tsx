// Author: Brijesh Dave <https://github.com/brijeshdave>
// Which optional modules this company uses.
//
// A third kind of answer, and the reason it lives here rather than on the system
// Settings page: not "may this person" and not "does this server offer it", but
// "does this company do this work at all". Two companies on one server can
// legitimately differ, and one of them should not have to look at the other's
// vocabulary in its sidebar.
//
// Switching a module off hides it and nothing else. No data is deleted — the
// cartridges and their history sit exactly where they were, out of reach until
// somebody turns it back on.
import { PARTS_MODULE, PERMISSIONS, partsModuleSchema } from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { usePermission } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { useForm } from "@/hooks/use-form.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { Button, Card } from "@/components/ui/primitives.js";
import { fetchCompanySettings, saveCompanySetting } from "@/services/settings.js";

export function ModulesTab({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const canUpdate = usePermission(PERMISSIONS.COMPANIES_UPDATE);

  const settings = useQuery({
    queryKey: ["companies", companyId, "settings"],
    queryFn: () => fetchCompanySettings(companyId),
  });

  const stored = settings.data?.find(
    (record) => record.namespace === PARTS_MODULE.namespace && record.key === PARTS_MODULE.key,
  );
  const parts = partsModuleSchema.parse(stored?.value ?? {});

  const save = useMutation({
    mutationFn: (value: { enabled: boolean; failureWindowDays: number }) =>
      saveCompanySetting(companyId, PARTS_MODULE.namespace, PARTS_MODULE.key, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["companies", companyId, "settings"] });
      // The sidebar reads this off the session, so the nav is stale until it
      // refetches — without this the module stays invisible until a reload.
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  if (settings.isLoading) return <Spinner />;
  if (settings.error) return <ErrorAlert error={settings.error} />;

  return (
    <Card className="max-w-2xl space-y-4 p-6">
      {save.error ? <ErrorAlert error={save.error} /> : null}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Cartridges</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Track refillable and repairable parts — printer cartridges, and anything else that
            cycles between the shelf, a machine and the workshop. Off, and nobody at this company
            sees it at all.
          </p>
        </div>
        <Button
          size="sm"
          variant={parts.enabled ? "secondary" : "primary"}
          disabled={!canUpdate || save.isPending}
          onClick={() => save.mutate({ ...parts, enabled: !parts.enabled })}
        >
          {parts.enabled ? "Switch off" : "Switch on"}
        </Button>
      </div>

      {parts.enabled ? (
        <div className="space-y-2 border-t border-border pt-4">
          <FailureWindow
            days={parts.failureWindowDays}
            canUpdate={canUpdate}
            onSave={(failureWindowDays) => save.mutateAsync({ enabled: true, failureWindowDays })}
          />
          <Alert tone="info">
            Changing this does not revisit anything already decided. A reversal that has happened
            stays, and one that did not is not applied retrospectively — the ledger is a record of
            what was decided at the time.
          </Alert>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The failure window, as a form rather than a box with a Save beside it.
 *
 * It validates against the module's own schema, which matters more here than the
 * message: the old field coerced with `Number(draft) || 0`, so a typo — or a
 * stray letter — saved **zero**, and zero is not a harmless default. It switches
 * the reversal off for the whole company, silently, in the course of what looked
 * like a failed edit.
 */
function FailureWindow({
  days,
  canUpdate,
  onSave,
}: {
  days: number;
  canUpdate: boolean;
  onSave: (days: number) => Promise<unknown>;
}) {
  const form = useForm({
    schema: partsModuleSchema.pick({ failureWindowDays: true }),
    initial: { failureWindowDays: String(days) },
    // Not `|| 0`: a value that is not a number must stay not a number, so the
    // schema can refuse it and say so instead of a quiet zero going to the server.
    //
    // The blank case is spelled out because `Number("")` is **0**, not `NaN` — so
    // coercing alone would have left the original bug in place for the commonest
    // way of hitting it, which is clearing the box and pressing Save.
    toPayload: (v) => ({
      failureWindowDays: v.failureWindowDays.trim() === "" ? NaN : Number(v.failureWindowDays),
    }),
    submit: (input) => onSave((input as { failureWindowDays: number }).failureWindowDays),
  });
  const typed = form.values.failureWindowDays;

  return (
    <form {...form.formProps} className="space-y-2">
      {form.formError ? <ErrorAlert error={form.formError} /> : null}

      <Field
        label="Failure window (days)"
        error={form.errorFor("failureWindowDays")}
        hint="A part that comes back faulty within this many days of going out reverses the points for the service before it. Longer than this and it wore out rather than the refill being wrong. Zero switches the reversal off entirely."
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            min="0"
            max="365"
            className="w-32"
            disabled={!canUpdate || form.submitting}
            {...form.register("failureWindowDays")}
          />
        )}
      </Field>

      {typed.trim() !== String(days) ? (
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={form.submitting}>
            {form.submitting ? <Spinner /> : null}
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => form.reset({ failureWindowDays: String(days) })}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </form>
  );
}
