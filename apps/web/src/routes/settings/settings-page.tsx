// Author: Brijesh Dave <https://github.com/brijeshdave>
// Admin settings, grouped by namespace. Every form is generated from the shared
// registry, so a new setting appears here the moment it is declared. Writes take
// effect immediately: the API reloads auth, logging and debug in place.
import {
  ALL_SETTING_DEFS,
  DEBUG_MODE,
  NOTIFICATION_DELIVERY,
  NOTIFICATION_MATRIX,
  defaultFor,
  type NotificationDeliverySettings,
  type NotificationMatrix,
  PERMISSIONS,
  humanizeKey,
  type SettingDef,
  formatDateTime,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { PageTabs } from "@/components/page-tabs.js";
import { SettingForm } from "@/components/settings/setting-form.js";
import { NotificationMatrixCard } from "@/routes/settings/notification-matrix.js";
import { Alert, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { errorMessage } from "@/lib/error-message.js";
import { SystemRolesNotice } from "@/routes/settings/system-roles-card.js";
import { debugQuery, queryKeys } from "@/lib/queries.js";
import { disableDebug, enableDebug } from "@/services/debug.js";
import { fetchAllSettings, saveSystemSetting, type SettingRecord } from "@/services/settings.js";

/** What each namespace is called on screen. A namespace with no entry here still
 * gets a tab — its own name, tidied up — because being unnamed is a smaller problem
 * than being unreachable. */
const NAMESPACE_LABELS: Record<string, string> = {
  auth: "Authentication",
  notifications: "Notifications",
  channels: "Channels",
  reports: "Reports",
  backups: "Backups",
  storage: "Storage",
  logging: "Logging",
  debug: "Debug",
  ui: "Appearance",
  access: "Access",
};

/**
 * The tabs, derived from the registry rather than hand-listed.
 *
 * A hand-listed set silently drops whole settings: it said auth/logging/debug/ui
 * long after the registry had grown channels, reports and storage, so the roll-up
 * factor, the upload limits and every messaging credential existed, validated and
 * documented — and could not be reached from the app at all. The registry is the one
 * place settings are declared; the screen that edits them has to read it.
 */
const TABS = [...new Set(ALL_SETTING_DEFS.map((def) => def.namespace))].map((id) => ({
  id,
  label: NAMESPACE_LABELS[id] ?? humanizeKey(id),
}));

/**
 * Debug is toggled through its own endpoints, not written as a raw setting; the
 * notification matrix is a fourteen-by-six grid the generated renderer would draw
 * as a key/value list of comma-separated strings — technically editable, and
 * unusable. Both get their own card below.
 */
const GENERATED_DEFS = ALL_SETTING_DEFS.filter(
  (def) => def.namespace !== "debug" && def.key !== NOTIFICATION_MATRIX.key,
);

export function SettingsPage({ tab }: { tab: string }) {
  const navigate = useNavigate({ from: "/settings" });
  const canManage = usePermission(PERMISSIONS.SETTINGS_MANAGE);
  const queryClient = useQueryClient();

  const settings = useQuery({ queryKey: ["settings"], queryFn: fetchAllSettings });

  const save = useMutation({
    mutationFn: ({ def, value }: { def: SettingDef; value: unknown }) =>
      saveSystemSetting(def.namespace, def.key, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      // A theme or table-default change alters the caller's own effective values.
      await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    },
  });

  if (settings.isLoading) return <Spinner />;
  if (settings.error) return <ErrorAlert error={settings.error} />;

  const activeTab = TABS.some((candidate) => candidate.id === tab) ? tab : "auth";
  const byKey = new Map(
    (settings.data ?? []).map((record: SettingRecord) => [
      `${record.namespace}.${record.key}`,
      record.value,
    ]),
  );

  const defsFor = (namespace: string) =>
    GENERATED_DEFS.filter((def) => def.namespace === namespace);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organisation-wide defaults. Changes apply immediately, without a restart."
        actions={canManage ? undefined : <Badge>Read only</Badge>}
      />

      <PageTabs
        tabs={TABS}
        active={activeTab}
        onSelect={(id) => void navigate({ search: { tab: id }, replace: true })}
      />

      <div className="flex flex-col gap-4 pt-6">
        {activeTab === "debug" ? (
          <DebugCard />
        ) : (
          <>
            {activeTab === "access" ? <SystemRolesNotice /> : null}
            {defsFor(activeTab).map((def) => (
              <SettingForm
                key={`${def.namespace}.${def.key}`}
                def={def}
                value={(byKey.get(`${def.namespace}.${def.key}`) ?? {}) as Record<string, unknown>}
                disabled={!canManage}
                onSave={(value) => save.mutateAsync({ def, value })}
              />
            ))}
            {activeTab === "notifications" ? (
              <NotificationMatrixCard
                // Whatever is stored, else the catalogue's own defaults — so the
                // grid shows what is actually being sent today, not a blank slate.
                matrix={
                  (byKey.get(
                    `${NOTIFICATION_MATRIX.namespace}.${NOTIFICATION_MATRIX.key}`,
                  ) as NotificationMatrix) ?? {}
                }
                delivery={
                  (byKey.get(
                    `${NOTIFICATION_DELIVERY.namespace}.${NOTIFICATION_DELIVERY.key}`,
                  ) as NotificationDeliverySettings) ?? defaultFor(NOTIFICATION_DELIVERY)
                }
                disabled={!canManage}
                onSave={(value) => save.mutateAsync({ def: NOTIFICATION_MATRIX, value })}
              />
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

const DURATIONS = [15, 60, 240];

function DebugCard() {
  const canToggle = usePermission(PERMISSIONS.DEBUG_TOGGLE);
  const [minutes, setMinutes] = useState(60);
  const queryClient = useQueryClient();

  const status = useQuery(debugQuery);

  const toggle = useMutation({
    mutationFn: (on: boolean) => (on ? enableDebug("system", minutes) : disableDebug("system")),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.debug });
    },
  });

  if (status.isLoading) return <Spinner />;

  const system = status.data?.system;
  const on = Boolean(system?.enabled);

  return (
    <Card className="max-w-lg p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">System debug mode</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Verbose request logging with query counts, for everyone. It always expires on its own,
            so it can't be left on by accident.
          </p>
        </div>
        <Badge tone={on ? "warning" : "neutral"}>{on ? "On" : "Off"}</Badge>
      </div>

      {on && system?.expiresAt ? (
        <Alert tone="info" className="mt-4">
          Turns off automatically at {formatDateTime(system.expiresAt)}.
        </Alert>
      ) : null}

      {toggle.error ? (
        <Alert tone="error" className="mt-4">
          {errorMessage(toggle.error)}
        </Alert>
      ) : null}

      <div className="mt-4 flex items-end gap-3">
        {!on ? (
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            For
            <select
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
              disabled={!canToggle}
              className="h-10 rounded-xl border border-border bg-background px-3 text-sm"
              aria-label="Debug duration in minutes"
            >
              {DURATIONS.map((option) => (
                <option key={option} value={option}>
                  {option} minutes
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <Button
          size="sm"
          variant={on ? "destructive" : "primary"}
          disabled={!canToggle || toggle.isPending}
          onClick={() => toggle.mutate(!on)}
        >
          {toggle.isPending ? <Spinner /> : null}
          {on ? "Turn off debug" : "Turn on debug"}
        </Button>
      </div>

      {DEBUG_MODE.description ? (
        <p className="mt-4 text-xs text-muted-foreground">{DEBUG_MODE.description}</p>
      ) : null}
    </Card>
  );
}
