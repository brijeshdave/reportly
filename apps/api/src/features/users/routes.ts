// Author: Brijesh Dave <https://github.com/brijeshdave>
// Users management (admin list/get/update, activate/deactivate) and profile
// self-service. Permission-gated + audited; Zod schemas validate + document.
import {
  PERMISSIONS,
  createUserSchema,
  discordHandleSchema,
  employeeIdSchema,
  groupSchema,
  listQuerySchema,
  mobileSchema,
  nameSchema,
  paginatedResult,
  userDepartmentSchema,
  usernameSchema,
  userSchema,
} from "@reportly/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { recordAudit } from "@/core/audit.js";
import { trackChanges } from "@/core/history.js";
import { parseUpload, sendXlsx } from "@/core/spreadsheet/http.js";
import * as departments from "@/features/departments/service.js";
import * as groups from "@/features/groups/service.js";
import * as users from "@/features/users/service.js";
import { buildExport, buildTemplate, parseCsv, parseXlsx } from "@/features/users/import-parse.js";
import { resolveListQuery } from "@/lib/resolve-list-query.js";

const idParams = z.object({ id: z.guid() });
const avatar = z.string().url().nullable().optional();
// A cleared free-text field arrives as null (or ""), so both are accepted.
const clearableText = (schema: typeof employeeIdSchema) => schema.nullable().optional();
const adminUpdateBody = z.object({
  name: nameSchema.optional(),
  email: z.string().email().optional(),
  username: usernameSchema.optional(),
  avatarUrl: avatar,
  designationId: z.guid().nullable().optional(),
  employeeId: clearableText(employeeIdSchema),
  countsOnLeaderboard: z.boolean().optional(),
  mobile: mobileSchema.nullable().optional(),
  whatsappOnMobile: z.boolean().optional(),
  telegramOnMobile: z.boolean().optional(),
  discordHandle: discordHandleSchema.nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
const profileBody = z.object({ name: nameSchema.optional(), avatarUrl: avatar });
const sessionSchema = z.object({
  token: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  /** True for the session making this request — "this device". */
  current: z.boolean(),
});

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const guard = (permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => [
    app.authenticate,
    app.companyContext,
    app.requirePermission(permission),
  ];

  // --- bulk export / import (static paths, before /:id) ---

  app.get(
    "/users/export",
    {
      preHandler: guard(PERMISSIONS.USERS_READ),
      schema: {
        tags: ["Users"],
        summary: "Export the roster (with each person's groups and companies) as an .xlsx",
      },
    },
    async (_request, reply) =>
      sendXlsx(reply, await buildExport(await users.exportUsers()), "users.xlsx"),
  );

  app.get(
    "/users/import/template",
    {
      preHandler: guard(PERMISSIONS.USERS_IMPORT),
      schema: { tags: ["Users"], summary: "Download the user import template (.xlsx)" },
    },
    async (_request, reply) => sendXlsx(reply, await buildTemplate(), "user-import-template.xlsx"),
  );

  app.post(
    "/users/import",
    {
      preHandler: guard(PERMISSIONS.USERS_IMPORT),
      schema: {
        tags: ["Users"],
        summary: "Create or update people in bulk from an .xlsx or .csv upload",
        description:
          "People are matched by email. A new person is created as an invite — no password is ever in the " +
          "file; a set-password link is sent and they choose their own. Groups and Companies (names separated " +
          "by | or ;) place the person; a blank cell leaves that placement unchanged. The Superadmin group is " +
          "refused. Rows are validated first: if any names something unknown nothing is written; once valid, " +
          "each row is applied and any that still fails is reported with its line number.",
        response: {
          200: z.object({
            created: z.number().int(),
            updated: z.number().int(),
            problems: z.array(z.object({ line: z.number().int(), message: z.string() })),
          }),
        },
      },
    },
    async (request) => {
      const parsed = await parseUpload(request, parseCsv, parseXlsx);
      const outcome = await users.importUsers(parsed, request.ctx!);
      if (outcome.created > 0 || outcome.updated > 0) {
        await recordAudit(request, request.ctx!, {
          action: "user.import",
          after: { created: outcome.created, updated: outcome.updated },
        });
      }
      return outcome;
    },
  );

  app.post(
    "/users/invite",
    {
      preHandler: guard(PERMISSIONS.USERS_CREATE),
      schema: {
        tags: ["Users"],
        summary: "Invite a user (emails a set-password link; no access until assigned to a group)",
        body: z.object({ email: z.string().email(), name: nameSchema }),
        response: { 201: userSchema },
      },
    },
    async (request, reply) => {
      const user = await users.inviteUser(request.body.email, request.body.name);
      await recordAudit(request, request.ctx!, { action: "user.invite", after: user });
      reply.status(201);
      return user;
    },
  );

  // The other way in, beside an invite: the administrator fills the profile and
  // may choose the first password. Giving one makes the account usable at once,
  // but the person is made to replace it before the app opens (mustChangePassword)
  // — a password its administrator knows is not a credential to leave standing.
  app.post(
    "/users",
    {
      preHandler: guard(PERMISSIONS.USERS_CREATE),
      schema: {
        tags: ["Users"],
        summary:
          "Create a user. With a password they can sign in at once (and must change it); without one, they are emailed a set-password link.",
        body: createUserSchema,
        response: { 201: userSchema },
      },
    },
    async (request, reply) => {
      const user = await users.createUser(request.body);
      await recordAudit(request, request.ctx!, {
        action: "user.create",
        // Never the password, not even its presence-by-omission: say plainly how
        // the account was made, and nothing about the secret itself.
        details: { withPassword: Boolean(request.body.password) },
        after: user,
      });
      reply.status(201);
      return user;
    },
  );

  app.get(
    "/users",
    {
      preHandler: guard(PERMISSIONS.USERS_READ),
      schema: {
        tags: ["Users"],
        summary: "List/search users (standard pagination/sort/filter)",
        querystring: listQuerySchema,
        response: { 200: paginatedResult(userSchema) },
      },
    },
    async (request) => users.listUsers(await resolveListQuery(request.query, request.authUserId)),
  );

  app.get(
    "/users/:id",
    {
      preHandler: guard(PERMISSIONS.USERS_READ),
      schema: {
        tags: ["Users"],
        summary: "Get a user",
        params: idParams,
        response: { 200: userSchema },
      },
    },
    async (request) => users.getUser(request.params.id),
  );

  // Groups are what grant access, so the user detail page leads with them.
  // Gated on groups:read, not users:read — it is group data.
  app.get(
    "/users/:id/groups",
    {
      preHandler: guard(PERMISSIONS.GROUPS_READ),
      schema: {
        tags: ["Users"],
        summary: "List the groups a user belongs to",
        params: idParams,
        response: { 200: z.array(groupSchema) },
      },
    },
    async (request) => groups.groupsForUser(request.params.id),
  );

  // The departments a user belongs to, across every company they touch. Gated on
  // departments:read — it is department data, shown on the user's Departments tab.
  app.get(
    "/users/:id/departments",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_READ),
      schema: {
        tags: ["Users"],
        summary: "List the departments a user belongs to (with their HOD flag)",
        params: idParams,
        response: { 200: z.array(userDepartmentSchema) },
      },
    },
    async (request) => departments.departmentsForUser(request.params.id),
  );

  // Placing a person from their own page: which groups they are in, and which
  // departments. Both mirror the resource's own assign permission.
  app.put(
    "/users/:id/groups",
    {
      preHandler: guard(PERMISSIONS.GROUPS_ASSIGN),
      schema: {
        tags: ["Users"],
        summary: "Set the groups a user belongs to (replaces the whole set)",
        params: idParams,
        body: z.object({ ids: z.array(z.guid()) }),
        response: { 200: z.object({ assigned: z.array(z.guid()) }) },
      },
    },
    async (request) => {
      await users.assignGroups(request.params.id, request.body.ids);
      await recordAudit(request, request.ctx!, {
        action: "user.assign.groups",
        after: { userId: request.params.id, ids: request.body.ids },
      });
      return { assigned: request.body.ids };
    },
  );

  app.put(
    "/users/:id/departments",
    {
      preHandler: guard(PERMISSIONS.DEPARTMENTS_ASSIGN),
      schema: {
        tags: ["Users"],
        summary: "Set the departments a user belongs to, and their rank in each",
        description:
          "Every other member of each department keeps their place, and this person keeps who they report to.",
        params: idParams,
        body: z.object({
          departments: z.array(z.object({ departmentId: z.guid(), rank: z.string() })),
        }),
        response: { 200: z.object({ assigned: z.number().int() }) },
      },
    },
    async (request) => {
      await users.assignDepartments(request.params.id, request.body.departments);
      await recordAudit(request, request.ctx!, {
        action: "user.assign.departments",
        after: { userId: request.params.id, departments: request.body.departments },
      });
      return { assigned: request.body.departments.length };
    },
  );

  // "Why can they do that": the roles their groups add up to, and the permissions
  // those roles grant. Derived exactly as the auth context derives it.
  app.get(
    "/users/:id/access",
    {
      preHandler: guard(PERMISSIONS.USERS_READ),
      schema: {
        tags: ["Users"],
        summary: "The roles and permissions a user effectively holds",
        params: idParams,
        response: {
          200: z.object({
            roles: z.array(z.object({ id: z.guid(), name: z.string(), isSystem: z.boolean() })),
            permissions: z.array(z.string()),
          }),
        },
      },
    },
    async (request) => users.effectiveAccessFor(request.params.id),
  );

  // Where this person may work. Scope belongs to the user: a group says what they
  // may do, this says where. Gated on users:update — it is a change to the person.
  app.get(
    "/users/:id/scope",
    {
      preHandler: guard(PERMISSIONS.USERS_READ),
      schema: {
        tags: ["Users"],
        summary: "The companies a user may open, and the sites they are narrowed to",
        params: idParams,
        response: {
          200: z.object({
            companies: z.array(z.guid()),
            // Empty means every site of those companies.
            locations: z.array(z.guid()),
          }),
        },
      },
    },
    async (request) => users.getScope(request.params.id),
  );

  app.put(
    "/users/:id/companies",
    {
      // NOT users:update. Placing someone into a company is cross-tenant by
      // nature — see the note on the permission.
      preHandler: guard(PERMISSIONS.USERS_ASSIGN_COMPANIES),
      schema: {
        tags: ["Users"],
        summary: "Set the companies a user may open (replaces the whole set)",
        params: idParams,
        body: z.object({ ids: z.array(z.guid()) }),
        response: { 200: z.object({ assigned: z.array(z.guid()) }) },
      },
    },
    async (request) => {
      await users.assignCompanies(request.params.id, request.body.ids);
      await recordAudit(request, request.ctx!, {
        action: "user.assign.companies",
        after: { userId: request.params.id, ids: request.body.ids },
      });
      return { assigned: request.body.ids };
    },
  );

  app.put(
    "/users/:id/locations",
    {
      preHandler: guard(PERMISSIONS.USERS_UPDATE),
      schema: {
        tags: ["Users"],
        summary: "Narrow a user to particular sites (empty = every site of their companies)",
        params: idParams,
        body: z.object({ ids: z.array(z.guid()) }),
        response: { 200: z.object({ assigned: z.array(z.guid()) }) },
      },
    },
    async (request) => {
      await users.assignLocations(request.params.id, request.body.ids);
      await recordAudit(request, request.ctx!, {
        action: "user.assign.locations",
        after: { userId: request.params.id, ids: request.body.ids },
      });
      return { assigned: request.body.ids };
    },
  );

  app.patch(
    "/users/:id",
    {
      preHandler: guard(PERMISSIONS.USERS_UPDATE),
      schema: {
        tags: ["Users"],
        summary: "Update a user (name/avatar/designation/employee id/status)",
        params: idParams,
        body: adminUpdateBody,
        response: { 200: userSchema },
      },
    },
    async (request) => {
      const before = await users.getUser(request.params.id);
      const user = await users.adminUpdateUser(request.params.id, request.body);
      await recordAudit(request, request.ctx!, { action: "user.update", before, after: user });
      await trackChanges(request, request.ctx!, "users", user.id, before, user);
      return user;
    },
  );

  for (const [action, status] of [
    ["deactivate", "inactive"],
    ["reactivate", "active"],
  ] as const) {
    app.post(
      `/users/:id/${action}`,
      {
        preHandler: guard(PERMISSIONS.USERS_UPDATE),
        schema: {
          tags: ["Users"],
          summary: `${action[0]!.toUpperCase()}${action.slice(1)} a user`,
          params: idParams,
          response: { 200: userSchema },
        },
      },
      async (request) => {
        const before = await users.getUser(request.params.id);
        const user = await users.setStatus(request.params.id, status);
        await recordAudit(request, request.ctx!, { action: `user.${action}`, before, after: user });
        await trackChanges(request, request.ctx!, "users", user.id, before, user);
        return user;
      },
    );
  }

  /**
   * Remove a user's second factor, so they can enrol again after losing their
   * authenticator and their recovery codes. There is no other way back: better-auth's
   * own disable endpoint demands the account's password *and* a passing second
   * factor, which is exactly what the locked-out person cannot supply.
   *
   * Gated on its own permission rather than users:update — this takes a lock off
   * somebody's account, which is not a profile edit — and the removal is audited
   * and emailed to them, because an account quietly losing a factor is the shape
   * of an attack as much as it is a favour.
   */
  app.post(
    "/users/:id/two-factor/reset",
    {
      preHandler: guard(PERMISSIONS.USERS_MANAGE_2FA),
      schema: {
        tags: ["Users"],
        summary:
          "Remove a user's two-factor enrolment (lost device/recovery codes). Signs them out everywhere and emails them.",
        params: idParams,
        response: { 200: z.object({ user: userSchema, wasEnabled: z.boolean() }) },
      },
    },
    async (request) => {
      const actor = request.ctx!.userId === request.params.id ? "You" : "An administrator";
      const result = await users.resetUserTwoFactor(request.params.id, actor);
      await recordAudit(request, request.ctx!, {
        action: "user.two-factor.reset",
        details: { userId: request.params.id, wasEnabled: result.wasEnabled },
      });
      return result;
    },
  );

  /**
   * Set a new password on someone else's account. Its own permission rather than
   * users:update — whoever holds it can take over any account — and audited, but the
   * password itself is never recorded. The account is forced to change it at next
   * sign-in and every session is cut.
   */
  app.post(
    "/users/:id/reset-password",
    {
      preHandler: guard(PERMISSIONS.USERS_RESET_PASSWORD),
      schema: {
        tags: ["Users"],
        summary: "Set a new password for a user (forces a change at next sign-in, signs them out)",
        params: idParams,
        body: z.object({ password: z.string().min(1) }),
        response: { 200: userSchema },
      },
    },
    async (request) => {
      const user = await users.adminResetPassword(request.params.id, request.body.password);
      await recordAudit(request, request.ctx!, {
        action: "user.reset-password",
        details: { userId: request.params.id },
      });
      return user;
    },
  );

  // Replaces better-auth's admin plugin routes, which authorized on a different
  // column and wrote no audit events.
  app.get(
    "/users/:id/sessions",
    {
      preHandler: guard(PERMISSIONS.USERS_READ),
      schema: {
        tags: ["Users"],
        summary: "List a user's live sessions",
        params: idParams,
        response: { 200: z.array(sessionSchema) },
      },
    },
    async (request) => users.listSessions(request.params.id, request.sessionToken),
  );

  // The token travels in the body, never the path: every request URL is written
  // to the log database, and a session token is a bearer credential until it
  // expires.
  app.post(
    "/users/:id/sessions/revoke",
    {
      preHandler: guard(PERMISSIONS.USERS_UPDATE),
      schema: {
        tags: ["Users"],
        summary: "Revoke one of a user's sessions, signing out that device",
        params: idParams,
        body: z.object({ token: z.string().min(1) }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await users.revokeUserSession(request.params.id, request.body.token);
      await recordAudit(request, request.ctx!, {
        action: "user.session.revoke",
        // Never the token itself: it is a bearer credential until it expires.
        details: { userId: request.params.id },
      });
      reply.status(204);
      return null;
    },
  );

  app.patch(
    "/me/profile",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Me"],
        summary: "Update your own profile",
        body: profileBody,
        response: { 200: userSchema },
      },
    },
    async (request) => users.updateProfile(request.authUserId!, request.body),
  );
}
