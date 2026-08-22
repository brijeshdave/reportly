// Author: Brijesh Dave <https://github.com/brijeshdave>
// GET /me — the authenticated user with their groups, accessible companies,
// in-scope location ids, and effective permissions for the active company.
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  ERROR_CODES,
  PARTS_MODULE,
  SYSTEM_ROLES_SETTING,
  locationSchema,
  myDayQuerySchema,
  myDaySchema,
  userDepartmentSchema,
} from "@reportly/shared";

import { db } from "@/core/db/index.js";
import { env } from "@/core/env.js";
import { colleaguesOf } from "@/features/departments/repo.js";
import { getEffectiveSetting, getSystemSetting } from "@/core/settings/service.js";
import { AppError } from "@/core/errors.js";
import { companies, groupUsers, groups, userCompanies, users } from "@/core/db/schema.js";
import { avatarVersions } from "@/features/avatars/repo.js";
import { myDay } from "@/features/me/my-day-service.js";
import * as departmentsService from "@/features/departments/service.js";
import * as locationsService from "@/features/locations/service.js";
import * as usersService from "@/features/users/service.js";

const mySessionSchema = z.object({
  token: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  current: z.boolean(),
});

export async function meRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Where the caller works — their own memberships, and the sites they may file
   * against.
   *
   * These exist because filing a journal entry, asking for a shift change or
   * creating a routine all need to *name* a department and a site, and the lists
   * that offer them were the administrative ones: `/users/:id/departments` behind
   * `departments:read`, `/locations` behind `locations:read`. Somebody holding
   * `journal:create` and nothing else therefore met "You are not in a department
   * yet" on a form they were entitled to use, with the category picker disabled
   * behind it because no department could be chosen.
   *
   * Authenticated is the only gate they need, and it is not an escalation: a
   * person's own placement is already in their session, and these add the names
   * for ids the client has been given anyway. Neither answers anything about
   * anybody else.
   */
  app.get(
    "/me/departments",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Me"],
        summary: "The departments the caller belongs to, for the pickers on forms they may use",
        response: { 200: z.array(userDepartmentSchema) },
      },
    },
    async (request) => departmentsService.departmentsForUser(request.authUserId!),
  );

  app.get(
    "/me/colleagues",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Me"],
        summary: "The people who share a department with the caller — for handovers and co-workers",
        response: {
          200: z.array(
            z.object({ userId: z.string(), name: z.string(), departmentName: z.string() }),
          ),
        },
      },
    },
    // Answers for the caller alone, so it needs no `users:read`. A handover picker
    // that required the right to enumerate every user in the company would be
    // invisible to exactly the people who hand work over.
    async (request) => {
      const companyId = request.ctx!.companyId;
      if (!companyId) return [];
      return colleaguesOf(request.authUserId!, companyId);
    },
  );

  app.get(
    "/me/locations",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Me"],
        summary: "The sites in the active company the caller may file against",
        response: { 200: z.array(locationSchema) },
      },
    },
    async (request) => {
      const companyId = request.ctx!.companyId;
      if (!companyId) return [];
      // The same scoped list the Locations screen shows, minus the permission to
      // administer them: this is "where may I file", not "manage the sites".
      return locationsService.listLocations(companyId, request.ctx!);
    },
  );

  app.get(
    "/me",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Me"],
        summary: "Current user with groups, companies, permissions for the active company",
      },
    },
    async (request) => {
      const ctx = request.ctx!;

      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          avatarUrl: users.avatarUrl,
          status: users.status,
          // The security screen needs to know whether to offer enrol or disable.
          twoFactorEnabled: users.twoFactorEnabled,
        })
        .from(users)
        .where(eq(users.id, ctx.userId));

      const userGroups = await db
        .select({ id: groups.id, name: groups.name })
        .from(groupUsers)
        .innerJoin(groups, eq(groups.id, groupUsers.groupId))
        .where(eq(groupUsers.userId, ctx.userId));

      // Companies the user can act in: all when superadmin, else via group links.
      // The status travels with the name: a deactivated company refuses every write,
      // and somebody should be told that when they switch into it rather than when
      // they press Save on a form they have already filled in.
      const accessibleCompanies = ctx.isSuperadmin
        ? await db
            .select({ id: companies.id, name: companies.name, status: companies.status })
            .from(companies)
        : await db
            // Companies belong to the person now, not to their groups.
            .selectDistinct({ id: companies.id, name: companies.name, status: companies.status })
            .from(userCompanies)
            .innerJoin(companies, eq(companies.id, userCompanies.companyId))
            .where(eq(userCompanies.userId, ctx.userId));

      const [avatarVersion] = (await avatarVersions([ctx.userId])).values();

      // Which optional modules this company uses. Read through the settings
      // registry rather than by calling the feature: `features/me` importing
      // `features/parts` would make the module unremovable, which is the whole
      // thing the isolation guard is there to prevent.
      const parts = ctx.companyId
        ? await getEffectiveSetting(PARTS_MODULE, { companyId: ctx.companyId })
        : null;

      // Whether the shipped roles grant anything. Sent for the same reason as the
      // module flags: a picker that offers a role conferring nothing is offering a
      // choice that does nothing, and there is no permission that says so.
      const systemRoles = await getSystemSetting(SYSTEM_ROLES_SETTING);

      return {
        user: { ...user, avatarVersion: avatarVersion ?? null },
        companyId: ctx.companyId,
        isSuperadmin: ctx.isSuperadmin,
        groups: userGroups,
        companies: accessibleCompanies,
        locationIds: ctx.locationIds,
        permissions: ctx.permissions,
        // Every other endpoint refuses an expired caller; the web app reads this
        // to send them straight to the change-password screen.
        passwordExpired: request.passwordExpired ?? false,
        // How much of the queue feature this server exposes. Sent alongside
        // permissions because it is the same kind of fact: what the caller may
        // do here. Holding queues:manage on a `read` install means nothing —
        // the route is not mounted — so the screen has to know both.
        queueAdmin: env.QUEUE_ADMIN,
        // Not a permission and not an install-wide switch: whether this company
        // does this work at all. Off, and the word should not appear in their
        // sidebar however their grants read.
        modules: { parts: parts?.enabled ?? false },
        systemRoles: systemRoles.enabled,
        // What the banner counts down, and what sends somebody to the setup screen
        // once it runs out. Reported rather than inferred from `twoFactorEnabled`,
        // because "enrolled" and "must enrol" are different questions.
        twoFactor: {
          required: request.twoFactor?.required ?? false,
          enrolled: request.twoFactor?.enrolled ?? user?.twoFactorEnabled ?? false,
          deadline: request.twoFactor?.deadline?.toISOString() ?? null,
          overdue: request.twoFactor?.overdue ?? false,
        },
      };
    },
  );

  const app2 = app.withTypeProvider<ZodTypeProvider>();

  // A user's own sessions. Served from our own sessions table rather than
  // better-auth's list-sessions, so it needs no elevated permission, has no
  // freshness requirement, and can flag which session is "this device".
  app2.get(
    "/me/sessions",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Me"],
        summary: "The caller's own live sessions, with the current one flagged",
        response: { 200: z.array(mySessionSchema) },
      },
    },
    async (request) => usersService.listSessions(request.authUserId!, request.sessionToken),
  );

  // The home screen, in one request. Session-only: every tile is the caller's own
  // work, so there is no permission to hold — the tiles that read another feature's
  // data are omitted (never 403'd) when the caller lacks that feature's read.
  app2.get(
    "/my-day",
    {
      preHandler: [app.authenticate, app.companyContext],
      schema: {
        tags: ["Me"],
        summary: "The caller's day: points, reports filed today, and what they still owe",
        description:
          "Sections are omitted rather than empty when the caller lacks the permission behind them — an absent " +
          "key means 'not yours to see', an empty array means 'you are clear'. `tzOffsetMinutes` is the caller's " +
          "UTC offset (east-positive, as negated `Date.getTimezoneOffset()`); without it the day is UTC's.",
        querystring: myDayQuerySchema,
        response: { 200: myDaySchema },
      },
    },
    async (request) => {
      const ctx = request.ctx!;
      if (!ctx.companyId) {
        throw new AppError(
          400,
          ERROR_CODES.VALIDATION_ERROR,
          "Pick a company first (X-Company-Id)",
        );
      }
      return myDay(ctx, ctx.companyId, request.query.tzOffsetMinutes ?? 0);
    },
  );

  // Revoke one of your own sessions. The token is in the body, never the path — a
  // session token is a bearer credential and every URL is written to the log DB.
  app2.post(
    "/me/sessions/revoke",
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ["Me"],
        summary: "Revoke one of the caller's own sessions",
        body: z.object({ token: z.string().min(1) }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await usersService.revokeUserSession(request.authUserId!, request.body.token);
      reply.status(204);
      return null;
    },
  );
}
