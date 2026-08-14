// Author: Brijesh Dave <https://github.com/brijeshdave>
// Settings API. Reads are gated by settings:read, system writes by settings:manage.
// A user may write their own value only for user-overridable settings.
import {
  ALL_SETTING_DEFS,
  ERROR_CODES,
  PASSWORD_POLICY,
  PERMISSIONS,
  findSettingDef,
  passwordRulesSchema,
  type SettingDef,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { env } from "@/core/env.js";
import { trackChanges } from "@/core/history.js";
import { reloadAuth } from "@/core/auth/auth.js";
import { reloadDebugConfig } from "@/core/debug/service.js";
import { AppError } from "@/core/errors.js";
import { reloadLogging } from "@/core/logger.js";
import {
  getCompanySetting,
  getEffectiveSetting,
  getSystemSetting,
  setCompanySetting,
  setSystemSetting,
  setUserSetting,
} from "@/core/settings/service.js";

const keyParams = z.object({ namespace: z.string().min(1), key: z.string().min(1) });
const valueBody = z.object({ value: z.unknown() });
const settingResponse = z.object({
  namespace: z.string(),
  key: z.string(),
  userOverridable: z.boolean(),
  description: z.string(),
  value: z.unknown(),
});

/**
 * What this company answers, falling back to the system value.
 *
 * Not `getEffectiveSetting`: that starts from the caller's own user override,
 * which has nothing to do with what a company does. Asking "is the module on for
 * Acme" must give the same answer whoever asks.
 */
async function getCompanySettingOrDefault(def: SettingDef, companyId: string): Promise<unknown> {
  return (await getCompanySetting(def, companyId)) ?? (await getSystemSetting(def));
}

function requireDef(namespace: string, key: string): SettingDef {
  const def = findSettingDef(namespace, key);
  if (!def) throw new AppError(404, ERROR_CODES.NOT_FOUND, `Unknown setting ${namespace}.${key}`);
  return def;
}

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  // Public: the sign-up, reset and accept-invite forms must state the rules a
  // password has to satisfy before anyone has a session. Only the string rules
  // are exposed — expiry and reuse counts stay internal.
  app.get(
    "/password-rules",
    {
      schema: {
        tags: ["Settings"],
        summary: "Password rules for the sign-up and reset forms (public)",
        response: { 200: passwordRulesSchema },
      },
    },
    async () => {
      const policy = await getSystemSetting(PASSWORD_POLICY);
      return {
        minLength: policy.minLength,
        requireUppercase: policy.requireUppercase,
        requireNumber: policy.requireNumber,
        requireSymbol: policy.requireSymbol,
      };
    },
  );

  // Public: the login screen needs to know whether to offer a "create account"
  // link before anyone has a session.
  app.get(
    "/auth-config",
    {
      schema: {
        tags: ["Settings"],
        summary: "Public auth configuration for the login and register screens",
        response: { 200: z.object({ registrationEnabled: z.boolean() }) },
      },
    },
    async () => ({ registrationEnabled: env.ALLOW_REGISTRATION }),
  );

  app.get(
    "/settings",
    {
      preHandler: guard(PERMISSIONS.SETTINGS_READ),
      schema: {
        tags: ["Settings"],
        summary: "List all settings with their effective values",
        response: { 200: z.array(settingResponse) },
      },
    },
    async (request) =>
      Promise.all(
        ALL_SETTING_DEFS.map(async (def) => ({
          namespace: def.namespace,
          key: def.key,
          userOverridable: def.userOverridable,
          description: def.description,
          value: await getEffectiveSetting(def, { userId: request.authUserId }),
        })),
      ),
  );

  app.get(
    "/settings/:namespace/:key",
    {
      preHandler: guard(PERMISSIONS.SETTINGS_READ),
      schema: {
        tags: ["Settings"],
        summary: "Get a setting's effective value",
        params: keyParams,
        response: { 200: settingResponse },
      },
    },
    async (request) => {
      const def = requireDef(request.params.namespace, request.params.key);
      return {
        namespace: def.namespace,
        key: def.key,
        userOverridable: def.userOverridable,
        description: def.description,
        value: await getEffectiveSetting(def, { userId: request.authUserId }),
      };
    },
  );

  app.put(
    "/settings/:namespace/:key",
    {
      preHandler: guard(PERMISSIONS.SETTINGS_MANAGE),
      schema: {
        tags: ["Settings"],
        summary: "Set a system setting value",
        params: keyParams,
        body: valueBody,
        response: { 200: settingResponse },
      },
    },
    async (request) => {
      const def = requireDef(request.params.namespace, request.params.key);
      const before = await getSystemSetting(def);
      const value = await setSystemSetting(def, request.body.value);
      // Auth behaviour is baked into the better-auth instance and logging config is
      // an in-memory snapshot — refresh them so changes apply without a restart.
      if (def.namespace === "auth") await reloadAuth();
      if (def.namespace === "logging") await reloadLogging();
      if (def.namespace === "debug") await reloadDebugConfig();
      await recordAudit(request, request.ctx!, {
        action: "setting.update",
        details: { namespace: def.namespace, key: def.key },
        before,
        after: value,
      });
      await trackChanges(
        request,
        request.ctx!,
        "settings",
        `${def.namespace}.${def.key}`,
        before as Record<string, unknown>,
        value as Record<string, unknown>,
      );
      return {
        namespace: def.namespace,
        key: def.key,
        userOverridable: def.userOverridable,
        description: def.description,
        value,
      };
    },
  );

  /* ----------------------------- company scope ----------------------------- */

  // A third scope, between the server and the person: settings one company may
  // answer differently from another. Today that is which optional modules it
  // uses — whether this company refills cartridges is a fact about the company,
  // not about the installation and not about whoever is looking.
  //
  // Company writes take `companies:update`, not `settings:manage`: a person who
  // administers one company should be able to say what work it does without also
  // holding the keys to the server's password policy.
  app.get(
    "/companies/:companyId/settings",
    {
      preHandler: guard(PERMISSIONS.COMPANIES_READ),
      schema: {
        tags: ["Settings"],
        summary: "A company's effective values for the settings it may override",
        params: z.object({ companyId: z.guid() }),
        response: { 200: z.array(settingResponse) },
      },
    },
    async (request) =>
      Promise.all(
        ALL_SETTING_DEFS.filter((def) => def.companyOverridable).map(async (def) => ({
          namespace: def.namespace,
          key: def.key,
          userOverridable: def.userOverridable,
          description: def.description,
          value: await getCompanySettingOrDefault(def, request.params.companyId),
        })),
      ),
  );

  app.put(
    "/companies/:companyId/settings/:namespace/:key",
    {
      preHandler: guard(PERMISSIONS.COMPANIES_UPDATE),
      schema: {
        tags: ["Settings"],
        summary: "Set a company's value for a company-overridable setting",
        description:
          "Switching an optional module on or off for one company. Other companies on the " +
          "same server are unaffected, and nothing is deleted when a module goes off — its " +
          "data is simply out of reach until it comes back.",
        params: keyParams.extend({ companyId: z.guid() }),
        body: valueBody,
        response: { 200: settingResponse },
      },
    },
    async (request) => {
      const def = requireDef(request.params.namespace, request.params.key);
      if (!def.companyOverridable) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          `${def.namespace}.${def.key} is not something one company can answer differently`,
        );
      }
      const before = await getCompanySettingOrDefault(def, request.params.companyId);
      const value = await setCompanySetting(def, request.params.companyId, request.body.value);
      await recordAudit(request, request.ctx!, {
        action: "company.setting.update",
        details: { companyId: request.params.companyId, namespace: def.namespace, key: def.key },
        before,
        after: value,
      });
      return {
        namespace: def.namespace,
        key: def.key,
        userOverridable: def.userOverridable,
        description: def.description,
        value,
      };
    },
  );

  // Self-service: any authenticated caller may read the settings they are allowed
  // to override (theme, table defaults, debug). No settings:read is required —
  // these are the caller's own preferences, and the UI must load them before any
  // group has been assigned to that user.
  app.get(
    "/settings/me",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Settings"],
        summary: "Your effective values for the settings you may override",
        response: { 200: z.array(settingResponse) },
      },
    },
    async (request) =>
      Promise.all(
        ALL_SETTING_DEFS.filter((def) => def.userOverridable).map(async (def) => ({
          namespace: def.namespace,
          key: def.key,
          userOverridable: def.userOverridable,
          description: def.description,
          value: await getEffectiveSetting(def, { userId: request.authUserId }),
        })),
      ),
  );

  app.put(
    "/settings/me/:namespace/:key",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Settings"],
        summary: "Set your own value for a user-overridable setting",
        params: keyParams,
        body: valueBody,
        response: { 200: settingResponse },
      },
    },
    async (request) => {
      const def = requireDef(request.params.namespace, request.params.key);
      const value = await setUserSetting(def, request.authUserId!, request.body.value);
      return {
        namespace: def.namespace,
        key: def.key,
        userOverridable: def.userOverridable,
        description: def.description,
        value,
      };
    },
  );
}
