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
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { Button, Card } from "@/components/ui/primitives.js";
import { fetchCompanySettings, saveCompanySetting } from "@/services/settings.js";

export function ModulesTab({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const canUpdate = usePermission(PERMISSIONS.COMPANIES_UPDATE);
  const [windowDraft, setWindowDraft] = useState<string | null>(null);

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
      setWindowDraft(null);
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
          <Field
            label="Failure window (days)"
            hint="A part that comes back faulty within this many days of going out reverses the points for the service before it. Longer than this and it wore out rather than the refill being wrong. Zero switches the reversal off entirely."
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min="0"
                max="365"
                className="w-32"
                disabled={!canUpdate}
                value={windowDraft ?? String(parts.failureWindowDays)}
                onChange={(event) => setWindowDraft(event.target.value)}
              />
            )}
          </Field>
          {windowDraft !== null && Number(windowDraft) !== parts.failureWindowDays ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({ enabled: true, failureWindowDays: Number(windowDraft) || 0 })
                }
              >
                Save
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setWindowDraft(null)}>
                Cancel
              </Button>
            </div>
          ) : null}
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
