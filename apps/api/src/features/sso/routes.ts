// Author: Brijesh Dave <https://github.com/brijeshdave>
// SSO provider management API (settings-backed). Read is gated by settings:read,
// writes by settings:manage. Client secrets are never returned to the client.
// Zod route schemas double as runtime validation and OpenAPI documentation.
import {
  ERROR_CODES,
  PERMISSIONS,
  SSO_PROVIDERS,
  SSO_PROVIDER_LABELS,
  type SsoProviderConfig,
  type SsoProviderId,
  publicSsoProviderSchema,
  ssoProviderConfigSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { reloadAuth } from "@/core/auth/auth.js";
import { AppError } from "@/core/errors.js";
import {
  enabledProviders,
  getProvider,
  listProviders,
  setProvider,
} from "@/features/sso/service.js";

const redactedProviderSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string(),
  issuer: z.string(),
  clientSecretSet: z.boolean(),
});
// `partialRecord`, not `record`: zod 4 makes an enum-keyed record EXHAUSTIVE, and
// this endpoint returns only the providers that are actually configured. Under
// `record` the type demanded every provider be present, which is not what the
// route does and never was.
const providersMapSchema = z.partialRecord(z.enum(SSO_PROVIDERS), redactedProviderSchema);
// `id` is a plain string so the handler can return 404 (not a 400 validation
// error) for an unknown provider; valid values are the SSO_PROVIDERS.
const providerParamsSchema = z.object({
  id: z.string().describe(`One of: ${SSO_PROVIDERS.join(", ")}`),
});

/** Never expose the stored secret; signal only whether one is set. */
function redact(config: SsoProviderConfig): z.infer<typeof redactedProviderSchema> {
  return {
    enabled: config.enabled,
    clientId: config.clientId,
    issuer: config.issuer,
    clientSecretSet: config.clientSecret.length > 0,
  };
}

function assertProviderId(id: string): asserts id is SsoProviderId {
  if (!(SSO_PROVIDERS as readonly string[]).includes(id)) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, `Unknown SSO provider: ${id}`);
  }
}

export async function ssoRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const read = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.SETTINGS_READ),
  ];
  const manage = [
    app.authenticate,
    app.companyContext,
    app.requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  ];

  // Public on purpose: the sign-in page must render its provider buttons before
  // anyone is authenticated. Exposes only the id and label — never a config.
  // Path is deliberately not /sso/providers/enabled, which would collide with :id.
  app.get(
    "/sso/enabled-providers",
    {
      schema: {
        tags: ["SSO"],
        summary: "List enabled SSO providers (public; for the sign-in page)",
        response: { 200: z.array(publicSsoProviderSchema) },
      },
    },
    async () => {
      const providers = await enabledProviders();
      return providers.map(({ id }) => ({ id, label: SSO_PROVIDER_LABELS[id] }));
    },
  );

  app.get(
    "/sso/providers",
    {
      preHandler: read,
      schema: {
        tags: ["SSO"],
        summary: "List SSO providers (secrets redacted)",
        response: { 200: providersMapSchema },
      },
    },
    async () => {
      const all = await listProviders();
      return Object.fromEntries(Object.entries(all).map(([id, config]) => [id, redact(config)]));
    },
  );

  app.get(
    "/sso/providers/:id",
    {
      preHandler: read,
      schema: {
        tags: ["SSO"],
        summary: "Get a single SSO provider (secret redacted)",
        params: providerParamsSchema,
        response: { 200: redactedProviderSchema },
      },
    },
    async (req) => {
      assertProviderId(req.params.id);
      return redact(await getProvider(req.params.id));
    },
  );

  app.put(
    "/sso/providers/:id",
    {
      preHandler: manage,
      schema: {
        tags: ["SSO"],
        summary: "Create or update an SSO provider (enable requires all fields)",
        params: providerParamsSchema,
        body: ssoProviderConfigSchema,
        response: { 200: redactedProviderSchema },
      },
    },
    async (req) => {
      assertProviderId(req.params.id);
      const saved = await setProvider(req.params.id, req.body);
      // Apply provider changes to the live auth instance without a redeploy.
      await reloadAuth();
      return redact(saved);
    },
  );
}
