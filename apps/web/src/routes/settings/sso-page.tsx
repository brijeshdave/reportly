// Author: Brijesh Dave <https://github.com/brijeshdave>
// SSO provider configuration. A provider may only be enabled once every field it
// needs is filled — the same `missingRequiredFields` the API validates with, so
// the form can never offer a save the server would reject.
import {
  PERMISSIONS,
  SSO_PROVIDERS,
  SSO_PROVIDER_LABELS,
  SSO_PROVIDERS_REQUIRING_ISSUER,
  missingRequiredFields,
  type SsoProviderId,
} from "@reportly/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { usePermission } from "@/components/can.js";
import { Alert, Field, Input, Spinner } from "@/components/ui/form.js";
import { ErrorAlert } from "@/components/ui/error-alert.js";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives.js";
import { queryKeys } from "@/lib/queries.js";
import { fetchSsoProviders, saveSsoProvider, type RedactedSsoProvider } from "@/services/sso.js";

export function SsoPage() {
  const providers = useQuery({ queryKey: ["sso", "providers"], queryFn: fetchSsoProviders });

  if (providers.isLoading) return <Spinner />;
  if (providers.error) return <ErrorAlert error={providers.error} />;

  return (
    <>
      <PageHeader
        title="Single sign-on"
        description="Providers are applied without a restart. Client secrets are never shown again once saved."
      />

      <div className="flex flex-col gap-4">
        {SSO_PROVIDERS.map((id) => (
          <ProviderCard key={id} id={id} config={providers.data![id]} />
        ))}
      </div>
    </>
  );
}

function ProviderCard({ id, config }: { id: SsoProviderId; config: RedactedSsoProvider }) {
  const canManage = usePermission(PERMISSIONS.SETTINGS_MANAGE);
  const queryClient = useQueryClient();

  const [clientId, setClientId] = useState(config.clientId);
  const [issuer, setIssuer] = useState(config.issuer);
  // Empty means "keep the stored secret"; the API never sends it back to us.
  const [clientSecret, setClientSecret] = useState("");

  const needsIssuer = SSO_PROVIDERS_REQUIRING_ISSUER.includes(id);
  const hasSecret = config.clientSecretSet || clientSecret !== "";

  const save = useMutation({
    mutationFn: (enabled: boolean) =>
      saveSsoProvider(id, { enabled, clientId, clientSecret, issuer }),
    onSuccess: async () => {
      setClientSecret("");
      await queryClient.invalidateQueries({ queryKey: ["sso", "providers"] });
      // The sign-in page's provider buttons come from a different, public endpoint.
      await queryClient.invalidateQueries({ queryKey: queryKeys.ssoProviders });
    },
  });

  // Ask the shared rule, exactly as the API will.
  const missing = missingRequiredFields(id, {
    enabled: true,
    clientId,
    clientSecret: hasSecret ? "set" : "",
    issuer,
  });
  const canEnable = missing.length === 0;

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{SSO_PROVIDER_LABELS[id]}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {needsIssuer
              ? "Needs a client id, secret and issuer URL."
              : "Needs a client id and secret."}
          </p>
        </div>
        <Badge tone={config.enabled ? "success" : "neutral"}>
          {config.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {save.error ? <ErrorAlert error={save.error} /> : null}

        <Field label="Client ID">
          {(props) => (
            <Input
              {...props}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={!canManage || save.isPending}
            />
          )}
        </Field>

        <Field
          label="Client secret"
          hint={
            config.clientSecretSet
              ? "A secret is stored. Leave blank to keep it, or type a new one to replace it."
              : "Not set."
          }
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              value={clientSecret}
              placeholder={config.clientSecretSet ? "••••••••" : ""}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="off"
              disabled={!canManage || save.isPending}
            />
          )}
        </Field>

        {needsIssuer ? (
          <Field label="Issuer URL" hint="The OIDC discovery document is derived from this.">
            {(props) => (
              <Input
                {...props}
                value={issuer}
                onChange={(event) => setIssuer(event.target.value)}
                placeholder="https://id.example.com"
                disabled={!canManage || save.isPending}
              />
            )}
          </Field>
        ) : null}

        {!canEnable && !config.enabled ? (
          <Alert tone="info">Fill in {missing.join(" and ")} before enabling this provider.</Alert>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!canManage || save.isPending}
            onClick={() => save.mutate(config.enabled)}
          >
            {save.isPending ? <Spinner /> : null}
            Save
          </Button>

          <Button
            size="sm"
            variant={config.enabled ? "destructive" : "primary"}
            // Enabling is refused server-side while a required field is missing.
            disabled={!canManage || save.isPending || (!config.enabled && !canEnable)}
            onClick={() => save.mutate(!config.enabled)}
          >
            {config.enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
