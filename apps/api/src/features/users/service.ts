// Author: Brijesh Dave <https://github.com/brijeshdave>
// User business logic: the standard list query, profile self-service, and admin
// activate/deactivate with the last-Superadmin guard. Repo owns DB access.
import {
  type AuthContext,
  type Channel,
  type CreateUser,
  ERROR_CODES,
  PERMISSIONS,
  PASSWORD_POLICY,
  type ResolvedListQuery,
  type PaginatedResult,
  type UpdateUser,
  type User,
  can,
  passwordViolations,
  suggestUsername,
  toPaginatedResult,
} from "@reportly/shared";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getAuth } from "@/core/auth/auth.js";
import { db } from "@/core/db/index.js";
import { accounts } from "@/core/db/schema.js";
import { recordCurrentPassword } from "@/core/auth/password-history.js";
import { env } from "@/core/env.js";
import { revokeAllSessions, revokeSession } from "@/core/auth/account-status.js";
import { resetTwoFactor } from "@/core/auth/two-factor.js";
import { AppError } from "@/core/errors.js";
import { twoFactorResetEmail } from "@/core/mail/templates.js";
import { lockedIdentities, release } from "@/core/auth/login-throttle.js";
import { enqueueEmail } from "@/core/queue/email.js";
import { notify } from "@/core/queue/notifications.js";
import { getSystemSetting } from "@/core/settings/service.js";
import { avatarVersions } from "@/features/avatars/repo.js";
import { clearVerified } from "@/features/channels/repo.js";
import {
  type DepartmentMemberRow,
  departmentsForUser,
  getMembers,
  setMembers,
} from "@/features/departments/repo.js";
import {
  type UserRow,
  allUsersForExport,
  companiesByName,
  companiesForLocationIds,
  companyNamesByUser,
  countOtherActiveSuperadmins,
  designationsByName,
  getUserByEmail,
  getUserById,
  getUserByUsername,
  groupNamesByUser,
  groupsByName,
  insertUser,
  getUserCompanyIds,
  getUserLocationIds,
  isSuperadminMember,
  listUsers as listUserRows,
  listUserSessions,
  effectiveAccess,
  setUserCompanies,
  setUserGroups,
  setUserLocations,
  updateUserRow,
  userIdForSessionToken,
  usersByIdentities,
} from "@/features/users/repo.js";
import type { UserExportRow, UserParseResult } from "@/features/users/import-parse.js";

/** better-auth stores the email/password credential under this provider id. */
const CREDENTIAL_PROVIDER = "credential";

function serialize(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    avatarUrl: row.avatarUrl,
    designationId: row.designationId,
    designation: row.designation,
    employeeId: row.employeeId,
    countsOnLeaderboard: row.countsOnLeaderboard,
    mobile: row.mobile,
    whatsappOnMobile: row.whatsappOnMobile,
    telegramOnMobile: row.telegramOnMobile,
    discordHandle: row.discordHandle,
    emailVerified: row.emailVerified,
    twoFactorEnabled: row.twoFactorEnabled,
    mobileVerified: row.mobileVerifiedAt !== null,
    whatsappVerified: row.whatsappVerifiedAt !== null,
    telegramVerified: row.telegramVerifiedAt !== null,
    discordVerified: row.discordVerifiedAt !== null,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Trim a free-text profile field, normalising an all-whitespace value to null so
 * "clear this field" round-trips cleanly. */
function normalizeText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function requireUser(id: string): Promise<UserRow> {
  const row = await getUserById(id);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "User not found");
  return row;
}

/**
 * Attach each person's picture version. Fetched separately, in one query for the
 * whole page, rather than joined into the row: the bytes must never be dragged
 * through a listing, and the version is all a page needs to build the image URL.
 */
async function withAvatars(users: User[]): Promise<User[]> {
  const versions = await avatarVersions(users.map((user) => user.id));
  return users.map((user) => ({ ...user, avatarVersion: versions.get(user.id) ?? null }));
}

export async function listUsers(query: ResolvedListQuery): Promise<PaginatedResult<User>> {
  const { rows, total } = await listUserRows(query);
  return toPaginatedResult(await withAvatars(rows.map(serialize)), total, query);
}

export async function getUser(id: string): Promise<User> {
  const [user] = await withAvatars([serialize(await requireUser(id))]);
  return user!;
}

/** Email and login name are both unique; say which one clashed, not just "taken". */
async function assertIdentifiersFree(
  email: string,
  username: string,
  exceptUserId?: string,
): Promise<void> {
  const byEmail = await getUserByEmail(email);
  if (byEmail && byEmail.id !== exceptUserId) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "A user with that email already exists");
  }
  const byUsername = await getUserByUsername(username);
  if (byUsername && byUsername.id !== exceptUserId) {
    throw new AppError(409, ERROR_CODES.CONFLICT, "That username is taken");
  }
}

/**
 * Clear the sign-in throttle for one person.
 *
 * Both identifiers, because the limiter buckets by whichever the caller typed: a
 * person who tried their email three times and their username twice is behind two
 * counters and would otherwise be released from only one.
 */
export async function releaseLogin(userId: string): Promise<number> {
  const row = await getUserById(userId);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "User not found");
  const cleared = await release(row.email);
  const alsoCleared = row.username ? await release(row.username) : 0;
  return cleared + alsoCleared;
}

export interface LockedOutUser {
  userId: string;
  attempts: number;
  max: number;
  retryAfterSeconds: number | null;
}

/**
 * Who the sign-in throttle is currently holding out.
 *
 * Resolved from the live counter rather than a column, because there is no column:
 * a lockout is a fact about the last few minutes, and a stored copy of it would be
 * wrong the moment the window expired. An identity that matches nobody — somebody
 * guessing at an address that does not exist — is simply dropped; the users table
 * has no row to hang it on, and it is not a fact about any of these people.
 */
export async function lockedOutUsers(): Promise<LockedOutUser[]> {
  const locked = await lockedIdentities();
  if (locked.size === 0) return [];

  const rows = await usersByIdentities([...locked.keys()]);
  const found: LockedOutUser[] = [];

  for (const row of rows) {
    // One person can be behind two counters — they tried their email, then their
    // username. Report the worse of the two, which is the one keeping them out.
    const states = [row.email, row.username]
      .filter((identity): identity is string => Boolean(identity))
      .map((identity) => locked.get(identity.toLowerCase()))
      .filter((state) => state !== undefined);
    const worst = states.sort((a, b) => b.attempts - a.attempts)[0];
    if (!worst) continue;
    found.push({
      userId: row.id,
      attempts: worst.attempts,
      max: worst.max,
      retryAfterSeconds: worst.retryAfterSeconds,
    });
  }

  return found;
}

/** Send the set-password link an invited (or password-less) user signs in with. */
async function sendSetPasswordLink(email: string): Promise<void> {
  await getAuth().api.requestPasswordReset({
    body: { email, redirectTo: `${env.WEB_URL}/accept-invite` },
  });
}

/**
 * Invite a user: create the account (no password, no groups → no access until a
 * superadmin assigns) and email a set-password link. Accepting = better-auth's
 * reset-password flow. New invitees have no access until added to a group.
 */
export async function inviteUser(email: string, name: string): Promise<User> {
  const username = suggestUsername(email);
  await assertIdentifiersFree(email, username);
  const row = await insertUser({ id: randomUUID(), name, email, username });
  await sendSetPasswordLink(email);
  // A user belongs to no company until somebody places them in one, so this is a
  // system-wide notice: it reaches everyone who can create accounts, anywhere.
  await notify({
    type: "user.invited",
    companyId: null,
    actorUserId: null,
    title: `${name} was invited to Reportly`,
    body: "They have no company or group yet, so they can see nothing until placed.",
    link: "/users",
    entityKind: "user",
    entityId: row.id,
  });
  return serialize(row);
}

/**
 * Create a user outright, as an administrator — the alternative to inviting.
 *
 * With a password, the person can sign in at once, but `mustChangePassword` locks
 * the app to the change-password screen until they replace it: a credential the
 * administrator knows must not stay a working one. Without a password, this is an
 * invite with the profile filled in — they get the same set-password link.
 *
 * Like an invite, a new user has no groups, so they have no access to anything
 * until they are put in one.
 */
export async function createUser(input: CreateUser): Promise<User> {
  await assertIdentifiersFree(input.email, input.username);

  if (input.password) {
    const policy = await getSystemSetting(PASSWORD_POLICY);
    const violations = passwordViolations(policy, input.password);
    if (violations.length > 0) {
      throw new AppError(
        400,
        ERROR_CODES.VALIDATION_ERROR,
        violations.map((violation) => violation.message).join(". "),
      );
    }
  }

  const id = randomUUID();
  await insertUser({
    id,
    name: input.name,
    email: input.email,
    username: input.username,
    designationId: input.designationId ?? null,
    employeeId: input.employeeId ?? null,
    countsOnLeaderboard: input.countsOnLeaderboard,
    mobile: input.mobile ?? null,
    whatsappOnMobile: input.whatsappOnMobile,
    telegramOnMobile: input.telegramOnMobile,
    discordHandle: input.discordHandle ?? null,
    status: input.status,
  });

  if (input.password) {
    // better-auth owns the accounts table and the hashing; going through its
    // context keeps one implementation of "what a stored password is". The
    // account hook records it in the password history, so reuse rules see it.
    const ctx = await getAuth().$context;
    await ctx.internalAdapter.createAccount({
      userId: id,
      providerId: CREDENTIAL_PROVIDER,
      accountId: id,
      password: await ctx.password.hash(input.password),
    });
    // Set after the account exists: the account hook clears this flag on every
    // password change, and would have cleared the one we are setting.
    await updateUserRow(id, { mustChangePassword: true });
  } else {
    await sendSetPasswordLink(input.email);
  }

  return serialize((await getUserById(id))!);
}

/**
 * Set a new password on someone else's account, as an administrator. The way back in
 * where the emailed set-password link is not an option (no mail in dev, or a person
 * who simply cannot receive it), and how a tester signs in as another user.
 *
 * The account is replaced whether they had a password or were only ever invited. Like
 * an admin-chosen first password, it forces a change at next sign-in — a credential the
 * administrator knows must not stay a working one — and every existing session is cut.
 */
export async function adminResetPassword(id: string, newPassword: string): Promise<User> {
  await requireUser(id);

  const policy = await getSystemSetting(PASSWORD_POLICY);
  const violations = passwordViolations(policy, newPassword);
  if (violations.length > 0) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      violations.map((violation) => violation.message).join(". "),
    );
  }

  const ctx = await getAuth().$context;
  const hash = await ctx.password.hash(newPassword);
  // Replace any existing credential account with a fresh one (direct write, like the
  // superadmin reset), so this works before an invite has been accepted too.
  await db
    .delete(accounts)
    .where(and(eq(accounts.userId, id), eq(accounts.providerId, CREDENTIAL_PROVIDER)));
  await db.insert(accounts).values({
    id: randomUUID(),
    accountId: id,
    providerId: CREDENTIAL_PROVIDER,
    userId: id,
    password: hash,
  });
  // A direct write skips better-auth's hooks, so age the password for the reuse rule,
  // force a change, and sign every session out.
  await recordCurrentPassword(id);
  await updateUserRow(id, { mustChangePassword: true });
  await revokeAllSessions(id);

  return serialize((await getUserById(id))!);
}

/**
 * Strip a user's two-factor so they can enrol again — the way back for someone who
 * has lost both their authenticator and their recovery codes. better-auth's own
 * disable endpoint needs the account's password *and* a passing second factor, so
 * the one person who cannot use it is the one who is locked out.
 *
 * The account is left protected by its password alone, so the person is told by
 * email, unprompted: if they did not ask for this, that mail is how they learn an
 * administrator took a lock off their account.
 */
export async function resetUserTwoFactor(
  id: string,
  actorName: string,
): Promise<{ user: User; wasEnabled: boolean }> {
  const row = await requireUser(id);
  const wasEnabled = await resetTwoFactor(id);

  // Nothing was removed, so there is nothing to warn them about.
  if (wasEnabled) {
    await enqueueEmail({ to: row.email, ...twoFactorResetEmail(actorName) });
  }

  return { user: serialize((await getUserById(id))!), wasEnabled };
}

export interface UserSession {
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

/** A user's live sessions. Replaces better-auth's admin plugin route. */
/**
 * A user's live sessions. `currentToken` is the token of the session making the
 * request; the matching session is flagged `current` ("this device"). Viewing
 * another user's sessions, no token matches, so none is marked current — which is
 * correct: you cannot tell which of someone else's sessions they are using now.
 */
export async function listSessions(id: string, currentToken?: string): Promise<UserSession[]> {
  await requireUser(id);
  const rows = await listUserSessions(id);
  return rows.map((row) => ({
    token: row.token,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: row.token === currentToken,
  }));
}

/**
 * Revoke one of a user's sessions. The token must belong to that user: without
 * the check, anyone who could revoke their own session could revoke anyone's by
 * guessing a token against a user id they may read.
 */
export async function revokeUserSession(id: string, token: string): Promise<void> {
  await requireUser(id);
  const owner = await userIdForSessionToken(token);
  if (owner !== id) throw new AppError(404, ERROR_CODES.NOT_FOUND, "Session not found");
  await revokeSession(token);
}

export async function updateProfile(
  userId: string,
  fields: { name?: string; avatarUrl?: string | null },
): Promise<User> {
  const row = await updateUserRow(userId, fields);
  if (!row) throw new AppError(404, ERROR_CODES.NOT_FOUND, "User not found");
  return serialize(row);
}

/** Never deactivate the last active member of the Superadmin group. */
async function assertDeactivatable(userId: string): Promise<void> {
  if (!(await isSuperadminMember(userId))) return;
  if ((await countOtherActiveSuperadmins(userId)) === 0) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Cannot deactivate the last superadmin");
  }
}

export async function setStatus(id: string, status: "active" | "inactive"): Promise<User> {
  await requireUser(id);
  if (status === "inactive") await assertDeactivatable(id);
  const row = await updateUserRow(id, { status });
  // Sign them out everywhere. `authenticate` would refuse those sessions anyway;
  // this stops them lingering in Postgres and Redis until they expire.
  if (status === "inactive") await revokeAllSessions(id);
  return serialize(row!);
}

export async function adminUpdateUser(id: string, fields: UpdateUser): Promise<User> {
  const before = await requireUser(id);
  if (fields.status === "inactive") await assertDeactivatable(id);

  if (fields.email !== undefined || fields.username !== undefined) {
    await assertIdentifiersFree(
      fields.email ?? before.email,
      fields.username ?? before.username,
      id,
    );
  }

  const mobile = fields.mobile === undefined ? undefined : normalizeText(fields.mobile);
  const discordHandle =
    fields.discordHandle === undefined ? undefined : normalizeText(fields.discordHandle);

  await updateUserRow(id, {
    ...fields,
    employeeId: normalizeText(fields.employeeId),
    mobile,
    discordHandle,
    ...(fields.username !== undefined ? { displayUsername: fields.username } : {}),
  });

  // A proof is about an address, not a person: moving the address moves it out of
  // reach of the code that proved it. WhatsApp and Telegram ride on the mobile, so
  // they fall with it — and turning a flag off drops the channel entirely.
  const stale: Channel[] = [];
  if (mobile !== undefined && mobile !== before.mobile) {
    stale.push("mobile", "whatsapp", "telegram");
  }
  if (fields.whatsappOnMobile === false) stale.push("whatsapp");
  if (fields.telegramOnMobile === false) stale.push("telegram");
  if (discordHandle !== undefined && discordHandle !== before.discordHandle) stale.push("discord");
  if (fields.email !== undefined && fields.email !== before.email) stale.push("email");
  if (stale.length > 0) await clearVerified(id, [...new Set(stale)]);

  return serialize((await getUserById(id))!);
}

// --- scope: which companies a person may open, and which sites within them ---

/**
 * Where this person may work. Empty `locations` means every site of the companies
 * they hold — a person is unrestricted until somebody narrows them.
 */
export async function getScope(id: string): Promise<{ companies: string[]; locations: string[] }> {
  await requireUser(id);
  const [companies, locations] = await Promise.all([getUserCompanyIds(id), getUserLocationIds(id)]);
  return { companies, locations };
}

export async function assignCompanies(id: string, companyIds: string[]): Promise<void> {
  await requireUser(id);
  await setUserCompanies(id, [...new Set(companyIds)]);
}

/**
 * Narrow a person to particular sites. Every site must sit inside one of the
 * companies they hold, or the scope would name a place they cannot reach anyway —
 * which reads as access but grants none.
 */
export async function assignLocations(id: string, locationIds: string[]): Promise<void> {
  await requireUser(id);
  const unique = [...new Set(locationIds)];
  const found = await companiesForLocationIds(unique);
  if (found.length !== unique.length) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "One or more locations do not exist");
  }
  const held = new Set(await getUserCompanyIds(id));
  const offending = found.filter((l) => !held.has(l.companyId));
  if (offending.length > 0) {
    throw new AppError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Each location must belong to one of the user's companies",
      { locationIds: offending.map((l) => l.id) },
    );
  }
  await setUserLocations(id, unique);
}

// --- placing a person: their groups and departments, from the person's side ---

/** Replace the whole set of groups this person belongs to. */
export async function assignGroups(id: string, groupIds: string[]): Promise<void> {
  await requireUser(id);
  await setUserGroups(id, [...new Set(groupIds)]);
}

/**
 * Put this person into exactly these departments, at the given rank.
 *
 * Department membership is normally edited from the department's own Members tab,
 * which owns the whole list including who reports to whom. Editing from the person's
 * side must not disturb that: every other member of each department is left exactly
 * as they were, and an existing membership keeps its `reportsToId` unless the rank
 * itself changes.
 */
const keep = (m: DepartmentMemberRow) => ({
  userId: m.userId,
  rank: m.rank,
  isCentral: m.isCentral,
  reportsToId: m.reportsToId,
  locationIds: m.locationIds,
});

/**
 * Set which departments somebody belongs to, and optionally their place in each.
 *
 * `rank` has always been settable here. `reportsToId` and `locationIds` are new
 * and **optional**, and the distinction matters: omitted means "leave it alone",
 * which is what lets this endpoint stay the bulk "put them in these departments"
 * call without quietly flattening a reporting line somebody built department by
 * department. Passing `null` for `reportsToId` is a real value — top of the line.
 */
export async function assignDepartments(
  id: string,
  entries: {
    departmentId: string;
    rank: string;
    reportsToId?: string | null;
    locationIds?: string[];
    isCentral?: boolean;
  }[],
): Promise<void> {
  await requireUser(id);
  const wanted = new Map(entries.map((e) => [e.departmentId, e]));
  const current = await departmentsForUser(id);
  const touched = new Set([...wanted.keys(), ...current.map((c) => c.departmentId)]);

  for (const departmentId of touched) {
    const members: DepartmentMemberRow[] = await getMembers(departmentId);
    const others = members.filter((m) => m.userId !== id);
    const entry = wanted.get(departmentId);
    const existing = members.find((m) => m.userId === id);

    const next = entry
      ? [
          ...others.map(keep),
          // Each field falls back to what is already there, so sending only a
          // rank still leaves the line and the sites exactly as the department's
          // own Members tab left them.
          {
            userId: id,
            rank: entry.rank,
            isCentral: entry.isCentral ?? existing?.isCentral ?? false,
            reportsToId:
              entry.reportsToId !== undefined ? entry.reportsToId : (existing?.reportsToId ?? null),
            locationIds: entry.locationIds ?? existing?.locationIds ?? [],
          },
        ]
      : others.map(keep);

    await setMembers(departmentId, next);
  }
}

/** The roles this person ends up with, and the permissions those add up to. */
export async function effectiveAccessFor(id: string): Promise<{
  roles: { id: string; name: string; isSystem: boolean }[];
  permissions: string[];
}> {
  await requireUser(id);
  return effectiveAccess(id);
}

/* ------------------------------ Import / export ---------------------------- */

/** Export the roster — one row per person, with their groups and companies. */
export async function exportUsers(): Promise<UserExportRow[]> {
  const [rows, groupsByUser, companiesByUser] = await Promise.all([
    allUsersForExport(),
    groupNamesByUser(),
    companyNamesByUser(),
  ]);
  return rows.map((u) => ({
    email: u.email,
    name: u.name,
    username: u.username,
    employeeId: u.employeeId,
    designation: u.designation,
    mobile: u.mobile,
    groups: groupsByUser.get(u.id) ?? [],
    companies: companiesByUser.get(u.id) ?? [],
    status: u.status === "inactive" ? "inactive" : "active",
  }));
}

export interface UserImportOutcome {
  created: number;
  updated: number;
  problems: { line: number; message: string }[];
}

/**
 * Apply an uploaded roster. People are matched by email; a new person is created as an
 * invite (no password — a set-password link is sent, they choose their own), and Groups /
 * Companies are set where the file lists them. Because account creation and the invite email
 * are side effects rather than one database transaction, this is validate-all-then-apply: if
 * any row names something unknown, nothing is written; once validation passes each row is
 * applied, and any that still fails is reported without undoing the ones before it.
 *
 * The Superadmin group is refused on purpose — bulk-granting the run of the whole system from
 * a spreadsheet is exactly the mistake to prevent; do it deliberately in the UI.
 */
export async function importUsers(
  parsed: UserParseResult,
  ctx: AuthContext,
): Promise<UserImportOutcome> {
  // The Companies column places a person into a tenant, which is the same act as
  // `PUT /users/:id/companies` and needs the same permission. Without this the
  // import was the softer way in of the two: the direct route at least needs the
  // other company's UUID, while a name is something you can simply type (SF-007).
  const mayAssignCompanies = ctx.isSuperadmin || can(ctx, PERMISSIONS.USERS_ASSIGN_COMPANIES);
  const problems = [...parsed.problems];
  if (parsed.rows.length === 0) return { created: 0, updated: 0, problems };

  const [designations, companies, groups] = await Promise.all([
    designationsByName(),
    companiesByName(),
    groupsByName(),
  ]);
  const desigId = new Map(designations.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const compId = new Map(companies.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const grpId = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g.id]));
  const superadminGroup = new Set(
    groups.filter((g) => g.isSystem && g.name === "Superadmin").map((g) => g.name.toLowerCase()),
  );

  interface Resolved {
    line: number;
    email: string;
    name: string;
    username: string | null;
    employeeId: string | null;
    mobile: string | null;
    designationId: string | null;
    groupIds: string[] | null;
    companyIds: string[] | null;
    status: "active" | "inactive";
  }

  const resolved: Resolved[] = [];
  const seen = new Set<string>();
  for (const row of parsed.rows) {
    const fail = (message: string) => problems.push({ line: row.line, message });
    if (seen.has(row.email)) fail(`"${row.email}" appears more than once in the file`);
    seen.add(row.email);

    let designationId: string | null = null;
    if (row.designation) {
      designationId = desigId.get(row.designation.toLowerCase()) ?? null;
      if (!designationId) {
        fail(`No designation called "${row.designation}"`);
        continue;
      }
    }

    let groupIds: string[] | null = null;
    if (row.groups !== null) {
      groupIds = [];
      for (const name of row.groups) {
        if (superadminGroup.has(name.toLowerCase())) {
          fail("The Superadmin group cannot be assigned by import; do it in the UI");
          continue;
        }
        const id = grpId.get(name.toLowerCase());
        if (!id) fail(`No group called "${name}"`);
        else groupIds.push(id);
      }
    }

    let companyIds: string[] | null = null;
    if (row.companies !== null) {
      // An empty cell leaves a person's companies alone, and that stays allowed
      // for everyone — it is the naming of a company that is the privileged act.
      if (row.companies.length > 0 && !mayAssignCompanies) {
        fail("You cannot set a person's companies (needs users:assign-companies)");
      }
      companyIds = [];
      for (const name of row.companies) {
        const id = compId.get(name.toLowerCase());
        if (!id) fail(`No company called "${name}"`);
        else companyIds.push(id);
      }
    }

    resolved.push({
      line: row.line,
      email: row.email,
      name: row.name,
      username: row.username,
      employeeId: row.employeeId,
      mobile: row.mobile,
      designationId,
      groupIds,
      companyIds,
      status: row.status === "inactive" ? "inactive" : "active",
    });
  }

  if (problems.length > 0) return { created: 0, updated: 0, problems };

  let created = 0;
  let updated = 0;
  const applyProblems: { line: number; message: string }[] = [];
  for (const row of resolved) {
    try {
      const existing = await getUserByEmail(row.email);
      let userId: string;
      if (existing) {
        await adminUpdateUser(existing.id, {
          name: row.name,
          ...(row.username ? { username: row.username } : {}),
          designationId: row.designationId,
          employeeId: row.employeeId,
          mobile: row.mobile,
          status: row.status,
        });
        userId = existing.id;
        updated += 1;
      } else {
        const user = await createUser({
          email: row.email,
          name: row.name,
          username: row.username ?? suggestUsername(row.email),
          designationId: row.designationId,
          employeeId: row.employeeId ?? undefined,
          countsOnLeaderboard: true,
          mobile: row.mobile ?? undefined,
          whatsappOnMobile: false,
          telegramOnMobile: false,
          status: row.status,
        });
        userId = user.id;
        created += 1;
      }
      // Companies must be set before locations would be (we set none here), and before
      // groups so access is coherent once the person can sign in.
      if (row.companyIds !== null) await assignCompanies(userId, row.companyIds);
      if (row.groupIds !== null) await assignGroups(userId, row.groupIds);
    } catch (err) {
      const message = err instanceof AppError ? err.message : "Could not apply this row";
      applyProblems.push({ line: row.line, message });
    }
  }

  return { created, updated, problems: applyProblems };
}
