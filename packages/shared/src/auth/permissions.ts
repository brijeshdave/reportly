// Author: Brijesh Dave <https://github.com/brijeshdave>
// Permission catalogue, the resolved auth context, and `can()` — the single
// authorization primitive used by API route guards and web UI gating alike.

/**
 * Every permission is a stable `resource:action` string. This catalogue covers
 * the Phase 1 resources; later features append their own (keep alphabetized by
 * resource). Seeds and role definitions reference these constants.
 */
export const PERMISSIONS = {
  USERS_READ: "users:read",
  USERS_CREATE: "users:create",
  USERS_UPDATE: "users:update",
  // There is deliberately no `users:delete`. A person is DEACTIVATED, not
  // removed: `users.status` blocks sign-in in three layers (core/auth/
  // account-status.ts), and the account stays attached to the journal entries,
  // points, audit rows and reporting line it is part of. Hard-deleting it would
  // either orphan that history or rewrite it, and neither is a thing an
  // administrator should be offered by a checkbox.
  //
  // The permission used to exist. No route ever guarded it, so it granted
  // nothing while appearing in the roles matrix as though it granted the power
  // to erase somebody.
  /**
   * Strip someone's two-factor, so they can enrol again after losing their device
   * and their recovery codes. Deliberately its own permission rather than part of
   * `users:update`: whoever holds it can remove anybody's second factor, which is
   * a security decision, not a profile edit. The system roles grant it to
   * Superadmin and Admin only — Manager's grant is read/create/update, and this
   * matches none of those.
   */
  USERS_MANAGE_2FA: "users:manage-2fa",
  /**
   * See when somebody last signed in, from where, and on what.
   *
   * Its own permission because it is not "who works here" — it is a record of when
   * a colleague was at their desk, which is attendance data by another name, and a
   * directory listing has no business handing that to everybody who can read it.
   *
   * It governs the Sessions tab as well as the Last seen column. Those were behind
   * plain `users:read` until this existed, which made "gate the new column" pure
   * theatre: the tab beside it already showed strictly more — IP, device, times.
   * Granted with the two-factor and unlock powers, to the people who help others
   * get in, since that is when it is genuinely needed.
   */
  USERS_SESSIONS_READ: "users:sessions:read",
  /**
   * Bulk import/export of the roster. Its own permission, like every other resource's
   * :import, and a heavy one: one file can create accounts and place people in groups
   * (which grants access). It never carries a password — new people are invited (a
   * set-password link is sent) — and it refuses to assign the Superadmin group, which
   * must be done deliberately in the UI. Export rides on users:read.
   */
  USERS_IMPORT: "users:import",
  /**
   * Decide which companies a person belongs to.
   *
   * Its own permission, and deliberately granted to nobody below Admin. Placing
   * someone into a company is the one user-management act that is inherently
   * CROSS-tenant: it hands an account the keys to a company, and the
   * administrator doing it may not belong to that company themselves. An
   * administrator of one company has no business deciding who can see a
   * different one.
   *
   * It used to be part of `users:update`, which Access editor holds — so an
   * administrator of company A could grant any account access to company B, by
   * id through `PUT /users/:id/companies` and by NAME through the roster import
   * (SF-007). The name-based route needed no knowledge of the other tenant at
   * all; someone had only to type its name.
   *
   * Note what stays on `users:update`: narrowing a person to particular SITES.
   * `assignLocations` already refuses a site outside the companies that person
   * holds, so it can only ever narrow access that this permission granted.
   */
  USERS_ASSIGN_COMPANIES: "users:assign-companies",
  /**
   * Set a new password on someone else's account — the way back for a person who is
   * locked out where email delivery is not an option (and how a tester signs in as
   * another user). Its own permission, not part of `users:update`: whoever holds it
   * can take over any account, so the seed grants it to Superadmin and Admin only.
   * The new password forces a change at next sign-in and signs every session out.
   */
  USERS_RESET_PASSWORD: "users:reset-password",

  COMPANIES_READ: "companies:read",
  COMPANIES_CREATE: "companies:create",
  COMPANIES_UPDATE: "companies:update",
  COMPANIES_DELETE: "companies:delete",

  LOCATIONS_READ: "locations:read",
  LOCATIONS_CREATE: "locations:create",
  LOCATIONS_UPDATE: "locations:update",
  LOCATIONS_DELETE: "locations:delete",
  // Bulk import/export of the company's sites — its own permission, like every other
  // resource's :import, because one file can add or retire many sites at once. Export
  // rides on locations:read.
  LOCATIONS_IMPORT: "locations:import",

  DESIGNATIONS_READ: "designations:read",
  DESIGNATIONS_CREATE: "designations:create",
  DESIGNATIONS_UPDATE: "designations:update",
  DESIGNATIONS_DELETE: "designations:delete",

  // Journal domain — the daily record of issues and work (Phase 5). Everyone files
  // entries, so create is granted down to Member (see the seed's permissionsFor);
  // appraise is a manager-and-up act; the config catalogues (categories/severities/
  // statuses) are admin-only to manage.
  JOURNAL_READ: "journal:read",
  JOURNAL_CREATE: "journal:create",
  JOURNAL_UPDATE: "journal:update",
  JOURNAL_DELETE: "journal:delete",
  JOURNAL_APPRAISE: "journal:appraise",
  // Strike an entry from scoring. A head-of-department rejects an entry filed by someone
  // in their reporting line, which clears its scores and awards so it earns no points.
  // Granted to Manager explicitly (it is not a `:read/create/update` key), and scoped in
  // the service to the caller's own downline, like appraisal.
  JOURNAL_REJECT: "journal:reject",

  // Journal configuration is split by blast radius, not by tidiness.
  //
  // `journal-config:manage` keeps severities and statuses: the severity ladder
  // decides what every entry in the company is *worth*, and the status ladder
  // decides what counts as resolved, so both rewrite the meaning of work already
  // done. That stays a heavy grant.
  //
  // The three below are a department's own vocabulary — the words its people use
  // to file and find their work. They are granted separately so an admin can hand
  // them to whichever group should hold them; the seed's defaults are defaults,
  // not a rule. A role holding only `tags:manage` is a perfectly good role.
  JOURNAL_CONFIG_MANAGE: "journal-config:manage",
  // Bulk import/export of the whole journal vocabulary — severities, statuses,
  // categories and tags, in one file. Its own permission, like every other resource's
  // :import; it spans catalogues with different blast radii (the status workflow
  // decides what counts as finished), so it is granted only where the manage
  // grants already sit. Gates export too,
  // there being no single read permission across all four catalogues.
  JOURNAL_CONFIG_IMPORT: "journal-config:import",
  CATEGORIES_MANAGE: "categories:manage",
  DEVICE_TYPES_MANAGE: "device-types:manage",
  TAGS_MANAGE: "tags:manage",

  // Reliability and recurrence analytics over the reports domain. Named `view`,
  // not `read`, on purpose — the seed's `:read` filter grants every read
  // permission to Member, and this is the one reports-domain surface Member does
  // not get. It is granted to Manager explicitly instead (same as JOURNAL_APPRAISE),
  // because an aggregate cannot be filtered to the caller's downline the way a
  // report list is: MTBF that differs per viewer is not the asset's MTBF. So the
  // numbers cover everything on the asset, and the trade is that whoever holds this
  // learns how *many* reports an asset has without necessarily being able to open
  // each one. That is a fact about the machine, not about a person — but it is a
  // widening, so it stops at Manager. See `audit:view` / `logs:view` for the same
  // naming reasoning.
  ANALYTICS_VIEW: "analytics:view",
  /**
   * The Insights charts — the same facts the reports and analytics already carry,
   * drawn rather than tabulated.
   *
   * Its own permission rather than riding on `analytics:view`, because the two
   * answer different questions to different people. Analytics is the reliability
   * engineering view (MTBF, MTTR, what keeps recurring) and is a management
   * figure; Insights is the shape of the work — how many issues this month,
   * where downtime goes, who is contributing — which is the thing you put on a
   * wall screen. An organisation should be able to hand out the second without
   * the first, and `:view` (not `:read`) keeps it clear of the seed's
   * read/create/update regex, so Member does not get it by accident.
   */
  INSIGHTS_VIEW: "insights:view",

  // Generated reports — shaped, grouped, printable/exportable views over the
  // journal (daily/weekly/monthly, by location/person/category…). `view` (not
  // `read`), like `analytics:view`: a report is a management-facing surface, so a
  // Member does not get it from the seed's `:read` filter — it is granted to
  // Manager-and-up, and an admin may hand it to any other role.
  //
  // The rows a report contains are *always* scoped by the same reporting-line and
  // location rules as the journal list, whoever holds these — so `reports:view`
  // widens which report *shapes* a person may run, never which rows they may see.
  // `manage` is granted to Manager too, not only Admin: cloning a shipped report into
  // one's own and reusing it is the point, and a manager sharing a view reaches only
  // their own company. A shared view still shows each viewer only their scoped rows.
  //
  //   view    — open the Reports area and run the saved views you may see
  //   export  — download (Excel/HTML) and print an A4 copy
  //   manage  — create/clone/edit/delete custom saved views, and set who each
  //             one is shared with (private / whole company / specific groups)
  //
  // **One key per report** (`reports:view:<source>`), not one key for "reports".
  // A single `reports:view` meant that granting somebody the downtime figures also
  // handed them the leaderboard and the cartridge register — and, worse, silently
  // handed them every report added later. There is deliberately no umbrella key:
  // a new report starts granted to nobody, which is an administrator's decision
  // rather than an accident.
  //
  // Viewing includes taking a copy — the Excel export and the printable page.
  // Somebody who can read every row on screen can photograph it, and a matrix with
  // a separate export key per report is one nobody maintains. If a rule ever
  // requires export to be separable, it becomes its own key then, on evidence.
  REPORTS_VIEW_JOURNAL: "reports:view:journal",
  REPORTS_VIEW_DOWNTIME: "reports:view:downtime",
  REPORTS_VIEW_RELIABILITY: "reports:view:reliability",
  REPORTS_VIEW_LEADERBOARD: "reports:view:leaderboard",
  REPORTS_VIEW_SHIFT_ROSTER: "reports:view:shift_roster",
  REPORTS_VIEW_SHIFT_CHANGES: "reports:view:shift_changes",
  REPORTS_VIEW_SHIFT_COVERAGE: "reports:view:shift_coverage",
  REPORTS_VIEW_SHIFT_ATTENDANCE: "reports:view:shift_attendance",
  REPORTS_VIEW_ROUTINE_LOG: "reports:view:routine_log",
  REPORTS_VIEW_ROUTINE_COMPLIANCE: "reports:view:routine_compliance",
  REPORTS_VIEW_PART_REGISTER: "reports:view:part_register",
  REPORTS_VIEW_PART_SERVICES: "reports:view:part_services",
  REPORTS_VIEW_PART_CONSUMPTION: "reports:view:part_consumption",
  REPORTS_VIEW_PART_HEALTH: "reports:view:part_health",
  REPORTS_VIEW_PRINTER_HEALTH: "reports:view:printer_health",
  REPORTS_VIEW_PART_FAILURES: "reports:view:part_failures",
  REPORTS_VIEW_PART_WORKLOAD: "reports:view:part_workload",
  REPORTS_MANAGE: "reports:manage",

  // The dedicated leaderboard page — the podium ranking of people by points earned.
  // Its own permission rather than a fold of `reports:view`: the leaderboard names
  // and ranks individuals, which is a different disclosure from running an aggregate
  // report, and an org may well want the standings shown to people who never touch
  // the Reports area (or hidden from some who do). `view` (not `read`), like the
  // reports/analytics surfaces, so the seed's `:read` filter does not hand it to
  // every Member automatically. Who appears on the board is still scoped the same
  // way — company-wide for `analytics:view`, otherwise the caller's own line — so
  // this widens *reaching the page*, never *which people's points* it reveals.
  LEADERBOARD_VIEW: "leaderboard:view",

  // The self-serve points page: a person's own points ledger and their team's, plus a
  // summary. `:read` (not `:view`) on purpose, so the seed's read filter hands it to
  // every Member — everyone may see how their own points were earned. Which people's
  // points it reveals is still scoped the same way as the leaderboard: company-wide for
  // `analytics:view`, otherwise the caller's own reporting line (a Member sees only
  // themselves). This is a narrower, always-yours surface than the Reports area, which
  // stays behind `reports:view`.
  POINTS_READ: "points:read",

  // Shift & schedule management. `shifts:read` ends in `:read` on purpose, so the
  // seed's read filter hands it to every Member — the calendar is a shared surface
  // everyone consults, and requesting a swap of your own shift needs no more than
  // being able to see it (like posting a comment). `manage` builds the shift
  // catalogue and the per-department schedules (assign, publish, carry a month
  // forward); `approve` decides the swap requests that come up the reporting line.
  //
  //   read     — see shifts, the schedule calendar, and your own roster
  //   manage   — create/edit shifts, build/publish/carry-forward schedules
  //   approve  — approve or reject colleague-swap requests
  SHIFTS_READ: "shifts:read",
  SHIFTS_MANAGE: "shifts:manage",
  SHIFTS_APPROVE: "shifts:approve",

  // Team routines — recurring duties a manager gives their team. `routines:read` ends
  // in `:read` so Members get it (they see and complete the routines assigned to them);
  // `manage` creates/edits routines and their assignees (a manager, over their downline)
  // and runs the month-end points award; `log` records start/finish/notes/files on your
  // own occurrences.
  //
  //   read    — see routines you own or are assigned to, and their occurrences
  //   manage  — create/edit/pause/delete routines, set assignees, award month points
  //   log     — start/finish and annotate your own occurrences
  ROUTINES_READ: "routines:read",
  ROUTINES_MANAGE: "routines:manage",
  ROUTINES_LOG: "routines:log",

  // Master lists a report is scoped to. The structural asset tree and the flat
  // device registry are read by anyone filing a report (so they can pick scope);
  // maintaining them is a manager-and-up act, like the department structure.
  ASSETS_READ: "assets:read",
  ASSETS_CREATE: "assets:create",
  ASSETS_UPDATE: "assets:update",
  ASSETS_DELETE: "assets:delete",
  // Bulk-build the asset tree from a spreadsheet — its own permission, like devices:import,
  // because one file writes or moves a whole tree at once.
  ASSETS_IMPORT: "assets:import",
  // Bulk import/export of the global asset-type vocabulary. A dedicated permission (like
  // every other resource's :import) because one file rewrites the words every asset is
  // classified by; export rides on assets:read.
  ASSET_TYPES_IMPORT: "asset-types:import",
  DEVICES_READ: "devices:read",
  DEVICES_CREATE: "devices:create",
  DEVICES_UPDATE: "devices:update",
  DEVICES_DELETE: "devices:delete",
  /**
   * Bulk-create devices from a spreadsheet. Deliberately its own permission rather
   * than part of `devices:create`: one bad file writes hundreds of rows in a single
   * action, so handing somebody the ability to add a device one at a time is not the
   * same decision as handing them the ability to add a thousand.
   */
  DEVICES_IMPORT: "devices:import",

  // Downtime raised from a report. Anyone who files can open/close downtime on
  // their own report's scope; `manage` covers editing across the company.
  DOWNTIME_READ: "downtime:read",
  DOWNTIME_WRITE: "downtime:write",

  // Comments on a report or a task.
  //
  // **Posting** needs no permission of its own: if you can open the record you can
  // join its conversation, which is what keeps "everyone up the line can discuss
  // this" true without a second visibility rule to maintain.
  //
  // **Changing what has already been said** is different, and is granted rather
  // than assumed. A comment on a report is part of the record of what happened, so
  // editing or removing one is a right somebody is given — not a consequence of
  // having typed it. `update` and `delete` cover your *own* words; `moderate`
  // covers anybody's.
  //
  // Note the deliberate gap: there is no "edit anyone's". Removing somebody's
  // remark is a moderator's job; rewriting it puts words in their mouth, and no
  // role should be able to do that.
  COMMENTS_UPDATE: "comments:update",
  COMMENTS_DELETE: "comments:delete",
  COMMENTS_MODERATE: "comments:moderate",

  // Files hanging off a report. Whoever may see the record may read its files; the
  // service ties writing to the record's own edit rules, so this permission alone
  // never lets someone attach to a stranger's report.
  ATTACHMENTS_READ: "attachments:read",
  ATTACHMENTS_WRITE: "attachments:write",

  // Work handed to somebody. `update` is granted down to Member on purpose: the
  // person a task was given to is the person who marks it done. The service limits
  // that to tasks they were assigned or handed out, so the permission alone never
  // lets someone edit a stranger's task.
  TASKS_READ: "tasks:read",
  TASKS_CREATE: "tasks:create",
  /**
   * Give yourself work — and only yourself.
   *
   * `tasks:create` means "yourself or anyone below you", which cannot express
   * "myself only": somebody who happens to have a person under them in the
   * reporting line would be able to hand work down with it. This is the narrow
   * half, so a member may plan their own day while their manager keeps assigning
   * down as before. The same shape as `routines:log` beside `routines:manage`.
   */
  TASKS_CREATE_OWN: "tasks:create-own",
  TASKS_UPDATE: "tasks:update",
  TASKS_DELETE: "tasks:delete",

  DEPARTMENTS_READ: "departments:read",
  DEPARTMENTS_CREATE: "departments:create",
  DEPARTMENTS_UPDATE: "departments:update",
  DEPARTMENTS_DELETE: "departments:delete",
  // Adding/removing members and setting HODs. Separate from editing the
  // department itself, mirroring groups:assign.
  DEPARTMENTS_ASSIGN: "departments:assign",
  // Bulk import/export of the org tree (paths + status; membership is the user import's
  // concern). Its own permission, like every other resource's :import, because one file
  // can build a whole org structure at once. Export rides on departments:read.
  DEPARTMENTS_IMPORT: "departments:import",

  GROUPS_READ: "groups:read",
  GROUPS_CREATE: "groups:create",
  GROUPS_UPDATE: "groups:update",
  GROUPS_DELETE: "groups:delete",
  GROUPS_ASSIGN: "groups:assign",
  // Bulk import/export of groups and the roles they carry (members belong to the user
  // import). Its own permission, like every other resource's :import; export rides on
  // groups:read.
  GROUPS_IMPORT: "groups:import",

  ROLES_READ: "roles:read",
  ROLES_CREATE: "roles:create",
  ROLES_UPDATE: "roles:update",
  ROLES_DELETE: "roles:delete",
  ROLES_CLONE: "roles:clone",
  // Bulk import/export of roles and the permission keys they grant. Its own permission,
  // like every other resource's :import, because one file can redefine what every group
  // holding a role may do. Export rides on roles:read.
  ROLES_IMPORT: "roles:import",

  // System settings (e.g. SSO providers). `manage` is admin-only (does not match
  // the Manager role's read/create/update grant).
  SETTINGS_READ: "settings:read",
  SETTINGS_MANAGE: "settings:manage",

  // Turning on verbose debugging raises log volume, so it is admin-only.
  DEBUG_TOGGLE: "debug:toggle",

  // Audit trail + change history. `view` (not `read`) keeps it admin-only, since
  // audit rows carry before/after snapshots of other users' data.
  AUDIT_VIEW: "audit:view",

  // The change history of one record — who changed which field, and to what — on a
  // record the holder may already read. Deliberately separate from `audit:view`:
  // the company-wide trail is an administrator's tool, while "what happened to this
  // task?" is an ordinary question for whoever is working on it. Someone assigned a
  // task could see the task and not its history, which reads as the history being
  // broken rather than withheld.
  HISTORY_READ: "history:read",

  // Application logs may contain request context from any user — admin-only too.
  LOGS_VIEW: "logs:view",

  // Database and file backups — take, download, delete, and configure them. An
  // infrastructure-level grant; restore is guarded further (superadmin only) in the
  // service, since it replaces live data.
  BACKUPS_MANAGE: "backups:manage",

  // The background queues — email, notifications, maintenance, backups, the
  // month-end award run. Three grants, because they are three different
  // authorities over the same screen.
  //
  //   view    — the queues, their counts, and each job's state, attempts and
  //             failure reason. The operational question: is mail moving?
  //   inspect — the job PAYLOAD. An email job holds a real address and a full
  //             message body, for every company on the installation, so reading
  //             one is a window onto other tenants' mail. Split out for the same
  //             reason `audit:view` is admin-only: the rows carry other people's
  //             data, and "is the queue backed up" does not need it.
  //   manage  — retry, promote, remove a job; pause, resume, clean a queue.
  //             Pausing `email` stops every password reset, so it is not implied
  //             by being able to look.
  //
  // All three are additionally bounded by the QUEUE_ADMIN environment variable:
  // with it unset the routes are not mounted at all, and holding these grants
  // nothing. The env is the ceiling, the permission decides who acts within it.
  /**
   * Rotables — the cartridges the IT team refills and repairs.
   *
   * Split by act rather than by CRUD, because the acts are held by different
   * people. A technician services and deploys all day and has no business
   * editing the catalogue; whoever decides what a refill is worth is not
   * usually the person doing it.
   *
   *   read      — see parts, their history and what was done to them
   *   manage    — register parts, correct them, scrap them
   *   deploy    — install one on a printer, and book it back in
   *   service   — record a refill or a repair, which pays points
   *   configure — the catalogues: models, compatibility, kinds, consumables, rates
   *
   * `service` is separate from `deploy` because it is the one that pays: it
   * writes to the shared ledger, and self-crediting work is a different thing to
   * hand out than swapping a cartridge over.
   *
   * None of them do anything unless the company has the module switched on: the
   * setting says whether this company does this work at all, the permission says
   * who does it.
   */
  PARTS_READ: "parts:read",
  PARTS_MANAGE: "parts:manage",
  PARTS_DEPLOY: "parts:deploy",
  PARTS_SERVICE: "parts:service",
  PARTS_CONFIGURE: "parts:configure",

  QUEUES_VIEW: "queues:view",
  QUEUES_INSPECT: "queues:inspect",
  QUEUES_MANAGE: "queues:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** All permission strings as a set for O(1) validation. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/**
 * Location scope: an explicit list of location ids the caller is limited to, or
 * `"all"` (no company has an explicit location set → all of its locations).
 */
export type LocationScope = string[] | "all";

/**
 * The resolved per-request context. Middleware builds this from the session and
 * `X-Company-Id`; downstream code reads only from here, never re-derives it.
 */
export interface AuthContext {
  userId: string;
  companyId: string | null;
  permissions: Permission[];
  locationIds: LocationScope;
  isSuperadmin: boolean;
  debug: boolean;
}

/**
 * Optional attributes for future attribute-based rules (e.g. ownership,
 * location-scoped checks). Reserved now; `can()` ignores it until a resource
 * needs it, so callers can pass context without a later signature change.
 */
export type PermissionAttrs = Record<string, unknown>;

/**
 * Authorization decision. Superadmin bypasses all checks; otherwise the
 * permission must be present in the context. Pure and synchronous.
 */
export function can(
  ctx: Pick<AuthContext, "permissions" | "isSuperadmin">,
  permission: Permission,
  _attrs?: PermissionAttrs,
): boolean {
  if (ctx.isSuperadmin) return true;
  return ctx.permissions.includes(permission);
}
