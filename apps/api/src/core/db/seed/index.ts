// Author: Brijesh Dave <https://github.com/brijeshdave>
// Idempotent database seeds: permission catalogue, system roles + their
// permissions, the Superadmin system group, the seeded superadmin user, and a
// demo company with an auto "Remote" location. Safe to run repeatedly (fixed ids
// + ON CONFLICT DO NOTHING); every phase adds its seeds here.
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ALL_SETTING_DEFS,
  DEFAULT_REPORT_COLUMNS,
  type Permission,
  type ReportDefinition,
  SSO_PROVIDERS,
  defaultFor,
  ssoProviderConfigSchema,
  suggestUsername as usernameFromEmail,
  ALL_REPORT_VIEW_PERMISSIONS,
  REPORT_SOURCES,
  REPORT_VIEW_PERMISSION,
  type ReportSource,
} from "@reportly/shared";
import { and, eq, notInArray, sql } from "drizzle-orm";

import { db, type Database } from "@/core/db/index.js";
import {
  companies,
  departments,
  journalStatuses,
  assetTypes,
  severities,
  groupRoles,
  groupUsers,
  groups,
  locations,
  permissions,
  reportViews,
  rolePermissions,
  roles,
  settings,
  users,
} from "@/core/db/schema.js";
import { env } from "@/core/env.js";

// Stable ids so re-runs are idempotent and rows are referenceable.
const SUPERADMIN_USER_ID = "00000000-0000-0000-0000-000000000001";
const DEMO_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const DEMO_DEPT_ENGINEERING = "22222222-2222-2222-2222-222222222221";
const DEMO_DEPT_BACKEND = "22222222-2222-2222-2222-222222222222";
const DEMO_DEPT_SALES = "22222222-2222-2222-2222-222222222223";
const SUPERADMIN_GROUP = "Superadmin";

/**
 * Deleting is a superadmin's act, not an administrator's — the rule the tiers below
 * and the area roles further down both follow. An edit leaves a history; a deletion
 * takes the history with it.
 *
 * One exception, and it is about *whose* record: `comments:delete` is withdrawing
 * your own remark, not removing somebody else's work (that is `comments:moderate`,
 * which stays an administrator's grant either way). Treating it as a deletion left
 * a Manager able to withdraw a comment and an Admin not — caught by the ladder test,
 * which is the whole reason that test exists.
 */
const OWN_RECORD_DELETES: readonly string[] = [PERMISSIONS.COMMENTS_DELETE];

const canDelete = (permission: Permission): boolean =>
  permission.endsWith(":delete") && !OWN_RECORD_DELETES.includes(permission);

/**
 * Two more that an "everything but delete" administrator does not get: restoring over
 * the database, and raising log volume across every company. Neither is day-to-day
 * administration, and both are hard to undo.
 */
const NEVER_BELOW_SUPERADMIN: readonly Permission[] = [
  PERMISSIONS.BACKUPS_MANAGE,
  PERMISSIONS.DEBUG_TOGGLE,
];

// System roles and the permissions they grant, as a ladder over the whole system:
// Superadmin gets everything; Admin gets everything except deleting and the two
// switches that are destructive by nature; Manager may read/create/update; Member is
// read-only. (The Superadmin *group* additionally bypasses company scoping — that is
// a group property, not a role.)
export function permissionsFor(
  role: "Superadmin" | "Admin" | "Manager" | "Member" | "Viewer",
): Permission[] {
  if (role === "Superadmin") return [...ALL_PERMISSIONS];
  // Everything but deletion. An administrator runs the system day to day; removing a
  // record — and the history that goes with it — is a superadmin's decision, as are
  // restoring over the database and turning up logging across every company.
  if (role === "Admin") {
    return ALL_PERMISSIONS.filter(
      (p) => !canDelete(p) && !(NEVER_BELOW_SUPERADMIN as readonly string[]).includes(p),
    );
  }
  if (role === "Manager") {
    // The regex covers read/create/update; a manager also appraises their downline
    // (:appraise), records downtime and attaches files (:write) — none of which the
    // regex catches.
    const base = ALL_PERMISSIONS.filter((p) => /:(read|create|update)$/.test(p));
    return [
      ...base,
      PERMISSIONS.JOURNAL_APPRAISE,
      // A manager/HOD may reject an entry filed by their downline, striking its points.
      PERMISSIONS.JOURNAL_REJECT,
      PERMISSIONS.DOWNTIME_WRITE,
      PERMISSIONS.ATTACHMENTS_WRITE,
      // A manager owns the line, so they get its reliability figures. `:view` sits
      // outside the regex above by design — see the constant's note.
      PERMISSIONS.ANALYTICS_VIEW,
      // A manager runs and exports the reports they show upward, and builds their own
      // saved views — cloning a shipped one and tailoring it, or sharing one with
      // their team. All three, so "clone and reuse" is theirs, not only an admin's.
      ...ALL_REPORT_VIEW_PERMISSIONS,
      PERMISSIONS.REPORTS_MANAGE,
      // A manager sees the standings for their line (company-wide, since they also
      // hold analytics:view). `:view` sits outside the regex above, like the rest.
      PERMISSIONS.LEADERBOARD_VIEW,
      // A manager builds their department's schedule and approves its swaps.
      // (`shifts:read` comes from the regex; these two do not.)
      PERMISSIONS.SHIFTS_MANAGE,
      PERMISSIONS.SHIFTS_APPROVE,
      // A manager gives their team recurring routines and logs their own.
      // (`routines:read` comes from the `:read` filter for everyone.)
      PERMISSIONS.ROUTINES_MANAGE,
      PERMISSIONS.ROUTINES_LOG,
      // A department's own vocabulary — the words its people file and search by.
      // Defaults, not rules: these are ordinary permissions, so an admin can build
      // a role holding only one of them and hand it to whichever group should own
      // it. Severities and statuses stay behind report-config:manage, because they
      // change what work already recorded is worth.
      PERMISSIONS.CATEGORIES_MANAGE,
      PERMISSIONS.DEVICE_TYPES_MANAGE,
      PERMISSIONS.TAGS_MANAGE,
      // Their own words, both verbs. The regex above catches `:update` but not
      // `:delete`, which would leave a manager able to rewrite a comment but not
      // withdraw it — an odd half-right. `comments:moderate` (acting on other
      // people's) is deliberately NOT here: that stays an administrator's grant.
      PERMISSIONS.COMMENTS_UPDATE,
      PERMISSIONS.COMMENTS_DELETE,
    ];
  }
  // Member is read-only across the app — except that filing reports is the whole
  // point, and the people doing the daily reporting are usually Members. So they may
  // create reports, record the downtime on them, and attach the photo of the broken
  // belt. They also mark their own tasks done, which is an update. Nothing else, and
  // the service still ties every one of these to their own record.
  //
  // On comments, a Member may **correct** their own remark but not **remove** it.
  // That combination is deliberate rather than half-finished: fixing a typo keeps
  // the record accurate, while erasing what you said takes something out of it —
  // and an edit leaves an "edited" mark behind where a deletion leaves nothing.
  // `comments:delete` and `comments:moderate` therefore stay an administrator's
  // grant; drop `comments:update` from the list below to make comments immutable
  // for Members again.
  const read = ALL_PERMISSIONS.filter((p) => p.endsWith(":read"));

  // Viewer is Member without the filing: it looks at the work and touches none of
  // it. The tier an auditor, a visiting manager or a wall screen wants.
  //
  // Deliberately *only* the `:read` keys. The `:view` ones — analytics, insights,
  // the leaderboard, the seventeen reports — are the management figures, and each
  // already has a role of its own to hand out (`Analytics viewer`, `Reports
  // viewer`, …). Folding them in here would make the read-only tier the widest
  // grant of company figures in the system, which is the opposite of what its name
  // promises.
  if (role === "Viewer") return [...read];

  return [
    ...read,
    PERMISSIONS.JOURNAL_CREATE,
    PERMISSIONS.DOWNTIME_WRITE,
    PERMISSIONS.ATTACHMENTS_WRITE,
    PERMISSIONS.TASKS_UPDATE,
    PERMISSIONS.COMMENTS_UPDATE,
    // Members complete the routines assigned to them (their own occurrences only).
    PERMISSIONS.ROUTINES_LOG,
  ];
}

const SYSTEM_ROLES = ["Superadmin", "Admin", "Manager", "Member", "Viewer"] as const;

/** The broad tier names, for anything that needs to know what the release ships. */
export const SYSTEM_ROLE_NAMES: readonly string[] = SYSTEM_ROLES;

/**
 * Job-shaped roles, alongside the four broad ones above.
 *
 * The broad roles answer "how senior is this person"; these answer "what is this
 * person here to do" — the question an administrator actually has when wiring up a
 * group. Handing someone the run of the asset register should not also make them a
 * Manager of everything else, and before these it did: the only way to grant one
 * area was to clone a big role and strip it down by hand, every time.
 *
 * **Three tiers per area, uniformly: admin, editor, viewer.**
 *
 *   admin   owns the area — including the destructive and bulk verbs (delete,
 *           import, and whatever "configure this area" means for it)
 *   editor  does the daily work — create and update, but cannot delete, import,
 *           or change the area's configuration
 *   viewer  reads it
 *
 * They used to be uneven: Journal had three tiers, Assets and Organisation had
 * two, and Users, Groups, Roles, Shifts, Routines and System had exactly one —
 * an admin. So "let them keep the asset register up to date, but not delete
 * anything" had no answer, while "let them see who is in which group" required
 * granting the power to change it. The tier an area happened to have was an
 * accident of which phase built it.
 *
 * Two areas keep a single tier, and the reason is that a middle one would be
 * meaningless rather than merely unused:
 *   - Points & leaderboard is read-only by nature. Points are earned, never
 *     granted; there is nothing to edit.
 *   - Backups is one permission (backups:manage) covering taking, restoring and
 *     scheduling. Splitting it would produce a tier that can list backups and do
 *     nothing with them.
 *
 * These are system roles: refreshed by a re-seed (their grants are reconciled
 * against these lists, so removing a permission here removes it from the
 * database), and cloneable when an organisation wants a variant.
 */
/**
 * A viewer role per family of reports, built from `REPORT_SOURCES`.
 *
 * Seventeen reports is too many to hand out one at a time and too varied to hand
 * out at once: the shift lead who needs the roster reports has no business in the
 * cartridge consumption figures. The families are the ones the reports already fall
 * into by name, and a report added later lands in its family without anybody editing
 * this list — which is the point, since the next report will be written by somebody
 * who has not read this file.
 *
 * `journal:read` rides along because a report that reads the journal runs empty
 * without it.
 */
const REPORT_FAMILIES: { name: string; matches: (source: ReportSource) => boolean }[] = [
  { name: "Journal reports viewer", matches: (s) => s === "journal" },
  {
    name: "Reliability reports viewer",
    matches: (s) => s === "downtime" || s === "reliability",
  },
  { name: "Shift reports viewer", matches: (s) => s.startsWith("shift_") },
  { name: "Routine reports viewer", matches: (s) => s.startsWith("routine_") },
  {
    name: "Cartridge reports viewer",
    matches: (s) => s.startsWith("part_") || s === "printer_health",
  },
  { name: "Leaderboard reports viewer", matches: (s) => s === "leaderboard" },
];

const REPORT_FAMILY_ROLES: { name: string; permissions: Permission[] }[] = REPORT_FAMILIES.map(
  (family) => ({
    name: family.name,
    permissions: [
      ...REPORT_SOURCES.filter(family.matches).map((source) => REPORT_VIEW_PERMISSION[source]),
      PERMISSIONS.JOURNAL_READ,
    ],
  }),
);

/**
 * Area roles that do **not** come as a full ladder, and why.
 *
 * Most areas ship viewer / editor / admin, plus a superadmin wherever the area has
 * something to delete. These do not, because the missing tiers would be jobs nobody
 * has: points are earned rather than edited, a chart is a way of looking at work that
 * already happened, `backups:manage` is one permission covering take/schedule/restore,
 * a queue is either watched or worked, cartridges are done at a bench or administered,
 * and downtime is either read or recorded — there is no middle person in any of them.
 * A report family is a viewer by definition: there is nothing to edit about a shipped
 * report, and building saved views on top of them is what `Reports admin` is for.
 *
 * Exported because the role-shape tests assert against it. It used to be copied
 * into two test files, which meant adding a single-tier role failed two tests
 * that had no opinion about it — the list belongs beside the roles it describes.
 */
export const SINGLE_TIER_ROLES = [
  "Points & leaderboard viewer",
  "Backup operator",
  "Insights viewer",
  "Analytics viewer",
  "Queue viewer",
  "Queue operator",
  "Cartridge technician",
  "Cartridge admin",
  "Downtime viewer",
  "Downtime recorder",
  "Reports viewer",
  "Reports admin",
  ...REPORT_FAMILIES.map((family) => family.name),
] as const;

export const AREA_ROLES: { name: string; permissions: Permission[] }[] = [
  /* ---------------------------------------------------- assets & devices --- */
  {
    name: "Assets & devices admin",
    permissions: [
      PERMISSIONS.ASSETS_READ,
      PERMISSIONS.ASSETS_CREATE,
      PERMISSIONS.ASSETS_UPDATE,
      PERMISSIONS.ASSETS_DELETE,
      PERMISSIONS.ASSETS_IMPORT,
      PERMISSIONS.ASSET_TYPES_IMPORT,
      PERMISSIONS.DEVICES_READ,
      PERMISSIONS.DEVICES_CREATE,
      PERMISSIONS.DEVICES_UPDATE,
      PERMISSIONS.DEVICES_DELETE,
      PERMISSIONS.DEVICES_IMPORT,
      PERMISSIONS.DEVICE_TYPES_MANAGE,
      // A device belongs to a department, so placing one — one at a time or by
      // import — needs to see the department list.
      PERMISSIONS.DEPARTMENTS_READ,
    ],
  },
  {
    name: "Assets & devices editor",
    permissions: [
      PERMISSIONS.ASSETS_READ,
      PERMISSIONS.ASSETS_CREATE,
      PERMISSIONS.ASSETS_UPDATE,
      PERMISSIONS.DEVICES_READ,
      PERMISSIONS.DEVICES_CREATE,
      PERMISSIONS.DEVICES_UPDATE,
      PERMISSIONS.DEPARTMENTS_READ,
    ],
  },
  {
    name: "Assets & devices viewer",
    permissions: [PERMISSIONS.ASSETS_READ, PERMISSIONS.DEVICES_READ],
  },

  /* ------------------------------------------------------------ organisation --- */
  {
    name: "Organisation admin",
    permissions: [
      PERMISSIONS.COMPANIES_READ,
      PERMISSIONS.COMPANIES_CREATE,
      PERMISSIONS.COMPANIES_UPDATE,
      PERMISSIONS.COMPANIES_DELETE,
      PERMISSIONS.LOCATIONS_READ,
      PERMISSIONS.LOCATIONS_CREATE,
      PERMISSIONS.LOCATIONS_UPDATE,
      PERMISSIONS.LOCATIONS_DELETE,
      PERMISSIONS.LOCATIONS_IMPORT,
      PERMISSIONS.DEPARTMENTS_READ,
      PERMISSIONS.DEPARTMENTS_CREATE,
      PERMISSIONS.DEPARTMENTS_UPDATE,
      PERMISSIONS.DEPARTMENTS_DELETE,
      PERMISSIONS.DEPARTMENTS_ASSIGN,
      PERMISSIONS.DEPARTMENTS_IMPORT,
      PERMISSIONS.DESIGNATIONS_READ,
      PERMISSIONS.DESIGNATIONS_CREATE,
      PERMISSIONS.DESIGNATIONS_UPDATE,
      PERMISSIONS.DESIGNATIONS_DELETE,
    ],
  },
  {
    name: "Organisation editor",
    permissions: [
      PERMISSIONS.COMPANIES_READ,
      PERMISSIONS.COMPANIES_UPDATE,
      PERMISSIONS.LOCATIONS_READ,
      PERMISSIONS.LOCATIONS_CREATE,
      PERMISSIONS.LOCATIONS_UPDATE,
      PERMISSIONS.DEPARTMENTS_READ,
      PERMISSIONS.DEPARTMENTS_CREATE,
      PERMISSIONS.DEPARTMENTS_UPDATE,
      // Placing people in the tree is the daily half of running it; reshaping the
      // tree by deleting branches is not.
      PERMISSIONS.DEPARTMENTS_ASSIGN,
      PERMISSIONS.DESIGNATIONS_READ,
      PERMISSIONS.DESIGNATIONS_CREATE,
      PERMISSIONS.DESIGNATIONS_UPDATE,
    ],
  },
  {
    name: "Organisation viewer",
    permissions: [
      PERMISSIONS.COMPANIES_READ,
      PERMISSIONS.LOCATIONS_READ,
      PERMISSIONS.DEPARTMENTS_READ,
      PERMISSIONS.DESIGNATIONS_READ,
    ],
  },

  /* ---------------------------------------------------------------- journal --- */
  {
    name: "Journal admin",
    permissions: [
      PERMISSIONS.JOURNAL_READ,
      PERMISSIONS.JOURNAL_CREATE,
      PERMISSIONS.JOURNAL_UPDATE,
      PERMISSIONS.JOURNAL_DELETE,
      PERMISSIONS.JOURNAL_APPRAISE,
      PERMISSIONS.JOURNAL_REJECT,
      PERMISSIONS.JOURNAL_CONFIG_MANAGE,
      PERMISSIONS.JOURNAL_CONFIG_IMPORT,
      PERMISSIONS.CATEGORIES_MANAGE,
      PERMISSIONS.TAGS_MANAGE,
      PERMISSIONS.COMMENTS_UPDATE,
      PERMISSIONS.COMMENTS_DELETE,
      PERMISSIONS.COMMENTS_MODERATE,
      PERMISSIONS.ATTACHMENTS_READ,
      PERMISSIONS.ATTACHMENTS_WRITE,
    ],
  },
  {
    // Was "Journal contributor". The person filing the daily record: writes
    // entries and takes part in the conversation, but does not score anyone,
    // reject anything, or change the vocabulary everyone else files against.
    name: "Journal editor",
    permissions: [
      PERMISSIONS.JOURNAL_READ,
      PERMISSIONS.JOURNAL_CREATE,
      PERMISSIONS.JOURNAL_UPDATE,
      PERMISSIONS.COMMENTS_UPDATE,
      PERMISSIONS.ATTACHMENTS_READ,
      PERMISSIONS.ATTACHMENTS_WRITE,
    ],
  },
  {
    // The missing middle. Scoring was reachable only through "Journal admin",
    // which also hands over deletion, the shared vocabulary and comment
    // moderation — so a line manager who should score their own team either got
    // an administrator's powers or could not score at all. Reported from use:
    // "as HOD I am able to review all journal points but the reporting managers
    // should also be able to do that — for them there is no way to enter points".
    //
    // Reviewing is a *line* function, not an administrative one: who may score
    // whom is already decided by the reporting line, and this role only says the
    // person does that job. It deliberately excludes `journal:reject`, which
    // voids somebody's points and stays with the HOD.
    name: "Journal reviewer",
    permissions: [
      PERMISSIONS.JOURNAL_READ,
      PERMISSIONS.JOURNAL_CREATE,
      PERMISSIONS.JOURNAL_UPDATE,
      PERMISSIONS.JOURNAL_APPRAISE,
      // Refusing the work and scoring it are the same judgement, so the person who
      // reviews their team may also reject — it was HOD-only, which left a manager
      // able to score work they could not refuse.
      PERMISSIONS.JOURNAL_REJECT,
      PERMISSIONS.COMMENTS_UPDATE,
      PERMISSIONS.ATTACHMENTS_READ,
      PERMISSIONS.ATTACHMENTS_WRITE,
    ],
  },
  {
    name: "Journal viewer",
    permissions: [PERMISSIONS.JOURNAL_READ, PERMISSIONS.ATTACHMENTS_READ],
  },

  /* ---------------------------------------------------------------- reports --- */
  // Reports and analytics used to be one role. They are different things: the
  // reports library is a set of tables somebody runs and exports, the analytics and
  // insights charts are a management view of how the work is going. Granting one
  // should not grant the other.
  {
    // Builds and shares saved views on top of the reports themselves.
    name: "Reports admin",
    permissions: [
      ...ALL_REPORT_VIEW_PERMISSIONS,
      PERMISSIONS.REPORTS_MANAGE,
      PERMISSIONS.JOURNAL_READ,
    ],
  },
  {
    // Runs and exports every shipped report — viewing includes taking a copy.
    name: "Reports viewer",
    permissions: [...ALL_REPORT_VIEW_PERMISSIONS, PERMISSIONS.JOURNAL_READ],
  },

  /* -------------------------------------------------- reports, by subject --- */
  // Now that every report has its own key, a role per family: a shift lead gets the
  // rota reports without the cartridge figures, and a maintenance planner the
  // reliability ones without anybody's leaderboard standing. Generated from
  // REPORT_SOURCES rather than typed out, so a report added later joins its family
  // by name instead of by somebody remembering.
  ...REPORT_FAMILY_ROLES,

  /* -------------------------------------------------------------- analytics --- */
  {
    // Read-only by nature, like the leaderboard: a chart is a way of looking at work
    // that already happened. This is the reliability and downtime analytics, which
    // is a management figure rather than a report anybody files.
    name: "Analytics viewer",
    permissions: [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.JOURNAL_READ],
  },

  /* ------------------------------------------------------------------ tasks --- */
  // Tasks and downtime used to be one role, and they are not one job: handing work
  // out is a supervisor's act, recording an outage is whoever was standing at the
  // line when it stopped. Somebody who logs downtime should not thereby be able to
  // assign work to other people.
  {
    // The person who *does* the work. `tasks:update` is narrowed by the server to a
    // task they hold — see `assertMayUpdateTask` — so this tier moves their own work
    // along and gives work to nobody. The tier that was asked for and did not exist:
    // "cannot create tasks, but does work on the tasks assigned to them".
    name: "Tasks editor",
    permissions: [PERMISSIONS.TASKS_READ, PERMISSIONS.TASKS_UPDATE],
  },
  {
    // Hands work out, and may update anybody's task.
    name: "Tasks admin",
    permissions: [
      PERMISSIONS.TASKS_READ,
      PERMISSIONS.TASKS_CREATE,
      PERMISSIONS.TASKS_UPDATE,
      PERMISSIONS.TASKS_DELETE,
    ],
  },
  {
    name: "Tasks viewer",
    permissions: [PERMISSIONS.TASKS_READ],
  },

  /* --------------------------------------------------------------- downtime --- */
  {
    // Two roles rather than a ladder: `downtime:write` is the whole job, and there
    // is no third thing to administer. Recording an outage is not editing a record
    // somebody else owns, so no delete key exists to hold back.
    name: "Downtime recorder",
    permissions: [PERMISSIONS.DOWNTIME_READ, PERMISSIONS.DOWNTIME_WRITE],
  },
  {
    name: "Downtime viewer",
    permissions: [PERMISSIONS.DOWNTIME_READ],
  },

  /* ----------------------------------------------------------------- shifts --- */
  {
    // Was "Shift scheduler". Builds the catalogue and the calendars, and decides
    // swaps.
    name: "Shifts admin",
    permissions: [
      PERMISSIONS.SHIFTS_READ,
      PERMISSIONS.SHIFTS_MANAGE,
      PERMISSIONS.SHIFTS_APPROVE,
      PERMISSIONS.DEPARTMENTS_READ,
      // Run the scheduling reports (roster, changes, coverage, attendance) — they
      // live in the Reports area, so a scheduler needs reports:view to open them.
      ...ALL_REPORT_VIEW_PERMISSIONS,
    ],
  },
  {
    // The tier the split of shifts:manage and shifts:approve was always for:
    // decides swaps without owning the schedule. A supervisor covering the day,
    // not the person who builds the roster.
    name: "Shifts editor",
    permissions: [
      PERMISSIONS.SHIFTS_READ,
      PERMISSIONS.SHIFTS_APPROVE,
      PERMISSIONS.DEPARTMENTS_READ,
      ...ALL_REPORT_VIEW_PERMISSIONS,
    ],
  },
  {
    name: "Shifts viewer",
    permissions: [PERMISSIONS.SHIFTS_READ, PERMISSIONS.DEPARTMENTS_READ],
  },

  /* --------------------------------------------------------------- routines --- */
  {
    // Was "Routines manager".
    name: "Routines admin",
    permissions: [
      PERMISSIONS.ROUTINES_READ,
      PERMISSIONS.ROUTINES_MANAGE,
      PERMISSIONS.ROUTINES_LOG,
      ...ALL_REPORT_VIEW_PERMISSIONS,
    ],
  },
  {
    // Completes routines, cannot define them.
    name: "Routines editor",
    permissions: [PERMISSIONS.ROUTINES_READ, PERMISSIONS.ROUTINES_LOG],
  },
  {
    name: "Routines viewer",
    permissions: [PERMISSIONS.ROUTINES_READ],
  },

  /* ------------------------------------------------------------------ access --- */
  {
    // Was "User management" + "Group management" + "Roles management" as three
    // separate admin-only roles. They are one area: a group is a bundle of roles
    // over a set of users, and holding one third of it without the others mostly
    // produces screens that cannot be completed.
    name: "Access admin",
    permissions: [
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.USERS_MANAGE_2FA,
      PERMISSIONS.USERS_SESSIONS_READ,
      PERMISSIONS.USERS_RESET_PASSWORD,
      PERMISSIONS.USERS_IMPORT,
      PERMISSIONS.GROUPS_READ,
      PERMISSIONS.GROUPS_CREATE,
      PERMISSIONS.GROUPS_UPDATE,
      PERMISSIONS.GROUPS_DELETE,
      PERMISSIONS.GROUPS_ASSIGN,
      PERMISSIONS.GROUPS_IMPORT,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.ROLES_CREATE,
      PERMISSIONS.ROLES_UPDATE,
      PERMISSIONS.ROLES_DELETE,
      PERMISSIONS.ROLES_CLONE,
      PERMISSIONS.ROLES_IMPORT,
      // Placing a person needs to see the departments they go into.
      PERMISSIONS.DEPARTMENTS_READ,
      PERMISSIONS.DEPARTMENTS_ASSIGN,
    ],
  },
  {
    // Onboards people and puts them in the right groups. Deliberately WITHOUT
    // users:reset-password and users:manage-2fa — both let the holder take over
    // any account, which is a security decision rather than an administrative
    // one — and without any of the role verbs, so they can place someone into
    // access that exists but cannot invent new access.
    name: "Access editor",
    permissions: [
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_CREATE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.GROUPS_READ,
      PERMISSIONS.GROUPS_ASSIGN,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.DEPARTMENTS_READ,
      PERMISSIONS.DEPARTMENTS_ASSIGN,
    ],
  },
  {
    // "Who is in which group, and what does that grant?" — the question an
    // auditor or a team lead asks, which used to require the power to change the
    // answer.
    name: "Access viewer",
    permissions: [
      PERMISSIONS.USERS_READ,
      PERMISSIONS.GROUPS_READ,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.DEPARTMENTS_READ,
    ],
  },

  /* ------------------------------------------------------------------ system --- */
  {
    name: "System admin",
    permissions: [
      PERMISSIONS.SETTINGS_READ,
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.DEBUG_TOGGLE,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.LOGS_VIEW,
      PERMISSIONS.BACKUPS_MANAGE,
      PERMISSIONS.JOURNAL_CONFIG_MANAGE,
      PERMISSIONS.DEVICE_TYPES_MANAGE,
    ],
  },
  {
    // Runs the system day to day — reads the settings, watches the logs and the
    // audit trail — without being able to change the configuration, turn on debug
    // mode, or restore over the database.
    name: "System editor",
    permissions: [PERMISSIONS.SETTINGS_READ, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.LOGS_VIEW],
  },
  {
    name: "System viewer",
    permissions: [PERMISSIONS.SETTINGS_READ],
  },

  /* ------------------------------------------------ single-tier by nature --- */
  {
    // Points are earned, never granted, so there is no editor tier to have. The
    // board is scoped to the viewer's own reporting line.
    //
    // Deliberately WITHOUT departments:read. It was held for one reason — the
    // board's department picker read the whole department list — and that is a
    // picker's need, not a role's: seeing the leaderboard should not carry the
    // right to enumerate the organisation. The picker reads /me/departments
    // instead, which answers for the caller alone.
    name: "Points & leaderboard viewer",
    permissions: [PERMISSIONS.LEADERBOARD_VIEW, PERMISSIONS.POINTS_READ],
  },
  {
    // Read-only by nature, like the leaderboard: a chart is a way of looking at
    // work that already happened, so there is no editor tier to have. This is the
    // role for a wall screen or a visiting manager — the shape of the work
    // without the reports library or the reliability figures behind it.
    name: "Insights viewer",
    permissions: [
      PERMISSIONS.INSIGHTS_VIEW,
      // Every chart is drawn from the journal, and its department picker needs
      // the department list.
      PERMISSIONS.JOURNAL_READ,
      PERMISSIONS.DEPARTMENTS_READ,
    ],
  },
  {
    // backups:manage is one permission covering taking, scheduling and restoring.
    // A middle tier could list backups and do nothing with them, which is not a
    // job. Kept out of every other role deliberately: restoring replaces the
    // database, and it was previously reachable only by being a full Admin.
    name: "Backup operator",
    permissions: [PERMISSIONS.BACKUPS_MANAGE],
  },
  {
    // The person at the bench: installs parts, books them back in, and records
    // the refill or repair that pays for it.
    name: "Cartridge technician",
    permissions: [PERMISSIONS.PARTS_READ, PERMISSIONS.PARTS_DEPLOY, PERMISSIONS.PARTS_SERVICE],
  },
  {
    // Runs the module: the catalogues, the rates, and registering or scrapping
    // parts. Includes the technician's acts, since whoever runs it also does it.
    name: "Cartridge admin",
    permissions: [
      PERMISSIONS.PARTS_READ,
      PERMISSIONS.PARTS_MANAGE,
      PERMISSIONS.PARTS_DEPLOY,
      PERMISSIONS.PARTS_SERVICE,
      PERMISSIONS.PARTS_CONFIGURE,
    ],
  },
  {
    // The on-call answer to "is mail moving?" — counts and failure reasons, no
    // payloads and no buttons. Deliberately excludes `queues:inspect`: knowing
    // that eleven emails failed with "connection refused" is an infrastructure
    // fact, while reading who they were to is other people's correspondence.
    name: "Queue viewer",
    permissions: [PERMISSIONS.QUEUES_VIEW],
  },
  {
    // The person who actually clears a jam, and therefore needs to see what is in
    // the job that will not go. Pausing `email` stops every password reset, so
    // this is a deliberate grant rather than something a viewer grows into.
    //
    // Both roles do nothing at all unless the server runs with QUEUE_ADMIN set:
    // the routes are not mounted otherwise.
    name: "Queue operator",
    permissions: [PERMISSIONS.QUEUES_VIEW, PERMISSIONS.QUEUES_INSPECT, PERMISSIONS.QUEUES_MANAGE],
  },
];

/**
 * The report views shipped with the app. Each is a starting point management can run
 * as-is or clone and tailor. They carry a null company and null owner, and the
 * service refuses to edit or delete them — only to run or clone. Keyed by name so a
 * re-seed is idempotent (see the insert's onConflict).
 */
function def(
  partial: Partial<ReportDefinition> & Pick<ReportDefinition, "range" | "grouping">,
): ReportDefinition {
  return {
    source: "journal",
    columns: DEFAULT_REPORT_COLUMNS,
    filters: {},
    ...partial,
  };
}

// Every editor and admin tier may read the change history of a record it may
// already read. Applied by rule rather than typed into thirty roles: the next area
// role added gets it for free, and nobody has to remember which tier it belonged to.
// `audit:view` stays what it is — the company-wide trail, with other people's
// before/after data in it, and admin-only.
for (const role of AREA_ROLES) {
  if (/(editor|admin)$/.test(role.name)) role.permissions.push(PERMISSIONS.HISTORY_READ);
}

/**
 * **Deleting is a superadmin's act, not an administrator's.**
 *
 * An admin tier used to carry its area's `:delete` keys, so the role somebody is
 * given to run the day — add a device, fix a typo, place a person — was also the
 * role that could remove the record entirely. Those are different decisions with
 * different consequences: an edit is visible in the history, a deletion takes the
 * history with it.
 *
 * So every admin tier loses `:delete`, and every area that *has* a `:delete` key
 * gains a **superadmin** tier which is its admin plus exactly those keys. Derived
 * rather than typed out, because the two lists drifting apart is precisely the bug
 * this is meant to prevent — and an area whose deletions are added later gets its
 * superadmin tier the moment they are.
 */
const SUPERADMIN_TIERS = AREA_ROLES.filter(
  (role) => role.name.endsWith(" admin") && role.permissions.some(canDelete),
).map((role) => ({
  name: role.name.replace(/ admin$/, " superadmin"),
  permissions: [...role.permissions],
}));

for (const role of AREA_ROLES) {
  if (role.name.endsWith(" admin")) {
    role.permissions = role.permissions.filter((permission) => !canDelete(permission));
  }
}

AREA_ROLES.push(...SUPERADMIN_TIERS);

const SYSTEM_REPORT_VIEWS: { name: string; description: string; definition: ReportDefinition }[] = [
  {
    name: "Daily journal",
    description: "Everything filed today, in one flat list — the day's record at a glance.",
    definition: def({
      range: "today",
      grouping: "none",
      columns: [
        "date",
        "kind",
        "title",
        "category",
        "location",
        "asset",
        "workSummary",
        "duration",
      ],
    }),
  },
  {
    name: "Weekly summary",
    description: "This week's entries grouped by category, with the work done on each.",
    definition: def({
      range: "this_week",
      grouping: "category",
      columns: [
        "date",
        "kind",
        "title",
        "category",
        "location",
        "asset",
        "workSummary",
        "duration",
      ],
    }),
  },
  {
    name: "Monthly management summary",
    description:
      "This month by location — kinds, work done, time and points, for a management review.",
    definition: def({
      range: "this_month",
      grouping: "location",
      columns: [
        "date",
        "kind",
        "title",
        "category",
        "department",
        "asset",
        "workSummary",
        "duration",
        "points",
      ],
    }),
  },
  {
    name: "Issues this month",
    description:
      "Only issues this month, grouped by severity — description, status and where it happened.",
    definition: def({
      range: "this_month",
      grouping: "severity",
      filters: { kind: "issue" },
      columns: [
        "date",
        "title",
        "issueSummary",
        "severity",
        "status",
        "category",
        "location",
        "asset",
        "author",
      ],
    }),
  },
  {
    name: "Work done this month",
    description:
      "Only work logs this month, grouped by person — what was done and how long it took.",
    definition: def({
      range: "this_month",
      grouping: "author",
      filters: { kind: "work" },
      columns: ["date", "title", "workSummary", "category", "location", "asset", "duration"],
    }),
  },
  {
    name: "By location",
    description: "This month's entries gathered under each location, with subtotals.",
    definition: def({
      range: "this_month",
      grouping: "location",
      columns: ["date", "kind", "title", "category", "asset", "workSummary", "duration"],
    }),
  },
  {
    name: "By person",
    description: "This month's entries grouped by who reported them — work done, time and points.",
    definition: def({
      range: "this_month",
      grouping: "author",
      columns: [
        "date",
        "kind",
        "title",
        "category",
        "location",
        "workSummary",
        "duration",
        "points",
      ],
    }),
  },
  {
    name: "By category",
    description: "This month's entries grouped by category — what kinds of work and issues recur.",
    definition: def({
      range: "this_month",
      grouping: "category",
      columns: ["date", "kind", "title", "location", "asset", "workSummary", "duration"],
    }),
  },
  {
    name: "By asset / equipment",
    description: "This month grouped by asset — the issues and work each machine saw.",
    definition: def({
      range: "this_month",
      grouping: "asset",
      columns: [
        "date",
        "kind",
        "title",
        "issueSummary",
        "severity",
        "status",
        "workSummary",
        "duration",
      ],
    }),
  },
  {
    name: "Recurring issues",
    description:
      "Issues flagged as a repeat of an earlier one — what keeps coming back, by category.",
    definition: def({
      range: "this_year",
      grouping: "category",
      filters: { kind: "issue", recurring: true },
      columns: [
        "date",
        "title",
        "issueSummary",
        "category",
        "location",
        "asset",
        "severity",
        "status",
      ],
    }),
  },
  {
    name: "Open / ageing issues",
    description: "Issues not yet resolved, oldest first, with how many days they have been open.",
    definition: def({
      range: "this_year",
      grouping: "severity",
      filters: { kind: "issue", openOnly: true },
      columns: [
        "date",
        "age",
        "title",
        "issueSummary",
        "severity",
        "status",
        "location",
        "asset",
        "author",
      ],
    }),
  },
  {
    name: "Points by person",
    description: "This month's points earned, grouped by who reported the work.",
    definition: def({
      range: "this_month",
      grouping: "author",
      columns: ["date", "kind", "title", "category", "location", "duration", "points"],
    }),
  },
  {
    name: "Points by department",
    description: "This month's points, grouped by department — a team-level performance view.",
    definition: def({
      range: "this_month",
      grouping: "department",
      columns: ["date", "kind", "title", "author", "category", "duration", "points"],
    }),
  },
  {
    name: "Downtime this month",
    description: "Every outage this month, grouped by asset, with total downtime per machine.",
    definition: def({ source: "downtime", range: "this_month", grouping: "asset" }),
  },
  {
    name: "Reliability (MTBF / MTTR)",
    description:
      "Reliability rolled up per asset this month — failures, downtime, MTTR, MTBF, availability.",
    definition: def({ source: "reliability", range: "this_month", grouping: "none" }),
  },
  {
    name: "Reliability by month",
    description:
      "The reliability trend over the last year — one row per month for the chosen asset.",
    definition: {
      ...def({ source: "reliability", range: "this_year", grouping: "none" }),
      monthly: true,
    },
  },
  {
    name: "Reliability by device",
    description:
      "Reliability per device this month — which machine is failing, not just which line.",
    definition: {
      ...def({ source: "reliability", range: "this_month", grouping: "none" }),
      byDevice: true,
    },
  },
  {
    name: "Performance leaderboard",
    description:
      "People ranked by points earned this financial year — their own plus their team's.",
    definition: def({ source: "leaderboard", range: "this_fy", grouping: "none" }),
  },
  {
    name: "Leaderboard by department",
    description: "The performance leaderboard this financial year, ranked within each department.",
    definition: def({ source: "leaderboard", range: "this_fy", grouping: "department" }),
  },
  {
    name: "Shift change history",
    description:
      "Changes to a department's published schedule this month — edits and approved swaps, who and from→to. Pick the department when you run it.",
    definition: def({ source: "shift_changes", range: "this_month", grouping: "none" }),
  },
  {
    name: "Shift roster",
    description:
      "Who works which shift this month, one row per assignment. Pick the department when you run it.",
    definition: def({ source: "shift_roster", range: "this_month", grouping: "none" }),
  },
  {
    name: "Shift coverage & gaps",
    description:
      "Per scheduled day and shift this month: how many are on it, and which are uncovered. Pick the department.",
    definition: def({ source: "shift_coverage", range: "this_month", grouping: "none" }),
  },
  {
    name: "Shift attendance",
    description:
      "Working days, offs, leaves, holidays and double shifts per person this month. Pick the department.",
    definition: def({ source: "shift_attendance", range: "this_month", grouping: "none" }),
  },
  {
    name: "Routine log",
    description:
      "Your team's routine completions this month — who did what, and when they started and finished.",
    definition: def({ source: "routine_log", range: "this_month", grouping: "none" }),
  },
  {
    name: "Routine compliance",
    description:
      "Per person this month: routine occurrences due, completed, missed, and the on-time rate.",
    definition: def({ source: "routine_compliance", range: "this_month", grouping: "none" }),
  },

  // Cartridges. Shipped like the rest, and harmless where the module is off: the
  // library groups reports into domain tabs by what EXISTS, so without these
  // there is no Cartridges tab for anybody — including the companies that do use
  // it. Running one at a company with the module off is refused, which is the
  // same answer its own screens give.
  {
    name: "Cartridge register",
    description: "Every cartridge, where it is now, and how many times it has been round.",
    definition: def({ source: "part_register", range: "this_fy", grouping: "none" }),
  },
  {
    name: "Cartridge services",
    description:
      "Refills and repairs this month: what was done, by whom, what it used and what it paid.",
    definition: def({ source: "part_services", range: "this_month", grouping: "none" }),
  },
  {
    name: "Consumable usage",
    description:
      "How much toner, and how many drums and blades, went into the work this month. Usage, not stock.",
    definition: def({ source: "part_consumption", range: "this_month", grouping: "none" }),
  },
  {
    name: "Cartridge health",
    description: "Which cartridges fail or yield poorly, worst first — the ones worth retiring.",
    definition: def({ source: "part_health", range: "this_fy", grouping: "none" }),
  },
  {
    name: "Cartridge failures",
    description:
      "Every cartridge that came back faulty: how long it lasted, what it printed, the refill or repair it had first, and who did each.",
    definition: def({ source: "part_failures", range: "this_fy", grouping: "none" }),
  },
  {
    name: "Cartridge workload",
    description:
      "Who serviced how many cartridges, what they used, and how much of their work came back faulty.",
    definition: def({ source: "part_workload", range: "this_fy", grouping: "none" }),
  },
  {
    name: "Printer health",
    description:
      "Which printers eat cartridges. Several different ones failing in one machine is a printer fault, not a cartridge fault.",
    definition: def({ source: "printer_health", range: "this_fy", grouping: "none" }),
  },
];

export async function seedDatabase(database: Database = db): Promise<void> {
  await database.transaction(async (tx) => {
    // 1. Permission catalogue.
    await tx
      .insert(permissions)
      .values(ALL_PERMISSIONS.map((key) => ({ key })))
      .onConflictDoNothing({ target: permissions.key });

    const permRows = await tx
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions);
    const permIdByKey = new Map(permRows.map((p) => [p.key, p.id]));

    // 2. System roles + their permissions — the four broad ones, plus the job-shaped
    // area roles that can be dropped straight onto a group.
    await tx
      .insert(roles)
      .values(
        [...SYSTEM_ROLES.map((name) => ({ name: name as string })), ...AREA_ROLES].map((r) => ({
          name: r.name,
          isSystem: true,
        })),
      )
      .onConflictDoNothing({ target: roles.name });

    // **Only system roles**, and that filter is load-bearing rather than tidy.
    //
    // Roles are unique by name, so an administrator who creates "Tasks admin" for
    // their own use occupies a name a later release may ship. Looking the role up by
    // name alone — which is what this did — then reconciles *their* role against the
    // shipped definition and deletes every permission the definition does not list.
    // The comment below promised custom roles were untouched; the code did not check,
    // and four hand-made roles were overwritten on a real database before anyone
    // noticed. A shipped role that cannot claim its name is skipped instead: the
    // administrator's role is theirs, and losing a shipped one is recoverable by
    // renaming, while losing theirs is not.
    const roleRows = await tx
      .select({ id: roles.id, name: roles.name })
      .from(roles)
      .where(eq(roles.isSystem, true));
    const roleIdByName = new Map(roleRows.map((r) => [r.name, r.id]));

    const grantsByRole: { name: string; permissions: Permission[] }[] = [
      ...SYSTEM_ROLES.map((name) => ({ name: name as string, permissions: permissionsFor(name) })),
      ...AREA_ROLES,
    ];

    // A system role's grants are RECONCILED, not merely topped up: what the
    // definition above no longer lists is deleted.
    //
    // This used to be an insert with onConflictDoNothing and nothing else, which
    // meant a system role's permissions could only ever grow. Tightening one —
    // taking a permission away because it turned out to be too much — did nothing
    // at all on an existing install, and a re-seed after a restructure would
    // silently grant the union of the old set and the new one. The definitions in
    // this file are the source of truth, so the database is made to match them.
    //
    // Only `isSystem` roles are touched. A role an administrator cloned and
    // tailored is theirs, and nothing here may edit it.
    for (const { name: roleName, permissions: keys } of grantsByRole) {
      const roleId = roleIdByName.get(roleName);
      // Missing means a custom role holds the name (the insert above conflicts and
      // does nothing). Skipping is the safe half; the loud half is `cli doctor`,
      // which names the collision so it can be resolved deliberately.
      if (!roleId) continue;

      const wanted = keys
        .map((key) => permIdByKey.get(key))
        .filter((id): id is string => Boolean(id));

      if (wanted.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(wanted.map((permissionId) => ({ roleId, permissionId })))
          .onConflictDoNothing();
      }

      await tx
        .delete(rolePermissions)
        .where(
          wanted.length > 0
            ? and(
                eq(rolePermissions.roleId, roleId),
                notInArray(rolePermissions.permissionId, wanted),
              )
            : eq(rolePermissions.roleId, roleId),
        );
    }

    // 3. Superadmin system group linked to the Superadmin role.
    await tx
      .insert(groups)
      .values({ name: SUPERADMIN_GROUP, isSystem: true })
      .onConflictDoNothing({ target: groups.name });

    const superadminGroup = (
      await tx.select({ id: groups.id, name: groups.name }).from(groups)
    ).find((g) => g.name === SUPERADMIN_GROUP);
    const superadminRoleId = roleIdByName.get("Superadmin");
    if (superadminGroup && superadminRoleId) {
      await tx
        .insert(groupRoles)
        .values({ groupId: superadminGroup.id, roleId: superadminRoleId })
        .onConflictDoNothing();
    }

    // 4. Seeded superadmin user (password set later via `cli reset-superadmin`).
    // The login name is derived from the address so a fresh install has one
    // without asking for it; it is unique because the email is.
    const superadminUsername = usernameFromEmail(env.SUPERADMIN_EMAIL);
    await tx
      .insert(users)
      .values({
        id: SUPERADMIN_USER_ID,
        name: env.SUPERADMIN_NAME,
        email: env.SUPERADMIN_EMAIL,
        emailVerified: true,
        username: superadminUsername,
        displayUsername: superadminUsername,
        status: "active",
      })
      .onConflictDoNothing({ target: users.id });

    if (superadminGroup) {
      await tx
        .insert(groupUsers)
        .values({ groupId: superadminGroup.id, userId: SUPERADMIN_USER_ID })
        .onConflictDoNothing();
    }

    // 5. Demo company with an auto "Remote" location + one site.
    await tx
      .insert(companies)
      .values({ id: DEMO_COMPANY_ID, name: "Acme Corp" })
      .onConflictDoNothing({ target: companies.id });

    // Only into a company with no sites at all.
    //
    // Seeded by name, this fought the administrator exactly as the statuses did:
    // "Headquarters" renamed to "HO" no longer matched the conflict target, so every
    // migrate put "Headquarters" back beside it. A company that has named its own
    // sites has answered this question, and the seed has nothing to add.
    const siteRows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(locations)
      .where(eq(locations.companyId, DEMO_COMPANY_ID));

    if ((siteRows[0]?.n ?? 0) === 0) {
      await tx
        .insert(locations)
        .values([
          { companyId: DEMO_COMPANY_ID, name: "Remote", isRemote: true },
          { companyId: DEMO_COMPANY_ID, name: "Headquarters", isRemote: false },
        ])
        .onConflictDoNothing({ target: [locations.companyId, locations.name] });
    }

    // A small demo department tree so the org view has something to show:
    // Engineering › Backend, and a sibling Sales.
    await tx
      .insert(departments)
      .values([
        { id: DEMO_DEPT_ENGINEERING, companyId: DEMO_COMPANY_ID, name: "Engineering" },
        { id: DEMO_DEPT_SALES, companyId: DEMO_COMPANY_ID, name: "Sales" },
      ])
      .onConflictDoNothing({ target: departments.id });
    await tx
      .insert(departments)
      .values({
        id: DEMO_DEPT_BACKEND,
        companyId: DEMO_COMPANY_ID,
        name: "Backend",
        parentId: DEMO_DEPT_ENGINEERING,
      })
      .onConflictDoNothing({ target: departments.id });

    // 6. SSO providers seeded disabled (system-scoped settings). Insert only the
    // ones not already present (NULL userId isn't covered by the unique index).
    const existingSso = await tx
      .select({ key: settings.key })
      .from(settings)
      .where(and(eq(settings.namespace, "sso"), eq(settings.scope, "system")));
    const haveSso = new Set(existingSso.map((r) => r.key));
    const ssoRows = SSO_PROVIDERS.filter((p) => !haveSso.has(p)).map((p) => ({
      namespace: "sso",
      key: p,
      scope: "system",
      value: ssoProviderConfigSchema.parse({}),
    }));
    if (ssoRows.length > 0) {
      await tx.insert(settings).values(ssoRows);
    }

    // 7. Registry setting defaults (system scope), inserted only when missing.
    const existing = await tx
      .select({ namespace: settings.namespace, key: settings.key })
      .from(settings)
      .where(eq(settings.scope, "system"));
    const have = new Set(existing.map((r) => `${r.namespace}.${r.key}`));
    const defaultRows = ALL_SETTING_DEFS.filter((d) => !have.has(`${d.namespace}.${d.key}`)).map(
      (d) => ({
        namespace: d.namespace,
        key: d.key,
        scope: "system",
        value: defaultFor(d),
      }),
    );
    if (defaultRows.length > 0) {
      await tx.insert(settings).values(defaultRows);
    }

    // 8. Reports config: a generous severity ladder and the status workflow. All
    // 8. The starter vocabularies — severities, statuses, asset types.
    //
    // **Seeded only into an empty table.** They used to be inserted by name with
    // `onConflictDoNothing`, which quietly fought the administrator: a status deleted
    // because the organisation does not use it came back on the next upgrade, and one
    // renamed with different capitalisation ("On hold" -> "on hold") missed the
    // conflict target and arrived as a second row beside it. Neither is the seed's
    // decision to make. These are a starting point for an empty install, not a set
    // this file maintains — the same rule the shipped roles now follow.
    const isEmpty = async (table: typeof severities | typeof journalStatuses | typeof assetTypes) =>
      ((await tx.select({ n: sql<number>`count(*)::int` }).from(table))[0]?.n ?? 0) === 0;

    if (await isEmpty(severities)) {
      await tx
        .insert(severities)
        .values([
          { name: "Informational", orderIndex: 0 },
          { name: "Minor", orderIndex: 1 },
          { name: "Moderate", orderIndex: 2 },
          { name: "Major", orderIndex: 3 },
          { name: "Critical", orderIndex: 4 },
        ])
        .onConflictDoNothing({ target: severities.name });
    }

    if (await isEmpty(journalStatuses)) {
      await tx
        .insert(journalStatuses)
        .values([
          // Four working states, one finished state, three ways a report ends
          // without being fixed. Deliberately short: every extra status is a choice
          // somebody has to make correctly, and the old ladder carried three
          // different "done" states with no rule for picking between them.
          { name: "Open", group: "open", isTerminal: false, orderIndex: 0 },
          { name: "Acknowledged", group: "open", isTerminal: false, orderIndex: 1 },
          { name: "In progress", group: "open", isTerminal: false, orderIndex: 2 },
          { name: "On hold", group: "open", isTerminal: false, orderIndex: 3 },
          { name: "Resolved", group: "resolved", isTerminal: true, orderIndex: 4 },
          { name: "Duplicate", group: "rejected", isTerminal: true, orderIndex: 5 },
          // "Not an issue" rather than "False complaint": the old name blamed the
          // person who reported it, which discourages the reporting the whole app
          // exists to encourage.
          { name: "Not an issue", group: "rejected", isTerminal: true, orderIndex: 6 },
          { name: "Cancelled", group: "rejected", isTerminal: true, orderIndex: 7 },
        ])
        .onConflictDoNothing({ target: journalStatuses.name });
    }

    // 9. Asset types — the vocabulary the asset tree is built from. These are a
    // manufacturing plant's, because that is the first thing Reportly is used for;
    // they are data, not code, so a hospital renames them to Ward/Bed and the tree
    // means what it says there too.
    if (await isEmpty(assetTypes)) {
      await tx
        .insert(assetTypes)
        .values([
          { name: "Plant", orderIndex: 0 },
          { name: "Building", orderIndex: 1 },
          { name: "Area", orderIndex: 2 },
          { name: "Line", orderIndex: 3 },
          { name: "Station", orderIndex: 4 },
        ])
        .onConflictDoNothing({ target: assetTypes.name });
    }

    // 10. System report views — shipped report shapes, global (null company/owner)
    // and shown in every company. `company` access, so everyone holding reports:view
    // is offered them; the service still scopes the rows to the caller. A re-seed
    // refreshes the shipped shapes (their columns/description may have improved) while
    // leaving any customised clones — which are not system rows — untouched.
    const existingSystem = new Map(
      (
        await tx
          .select({ id: reportViews.id, name: reportViews.name })
          .from(reportViews)
          .where(eq(reportViews.isSystem, true))
      ).map((r) => [r.name, r.id]),
    );
    for (const v of SYSTEM_REPORT_VIEWS) {
      const existingId = existingSystem.get(v.name);
      if (existingId) {
        await tx
          .update(reportViews)
          .set({ description: v.description, definition: v.definition, access: "company" })
          .where(eq(reportViews.id, existingId));
      } else {
        await tx.insert(reportViews).values({
          companyId: null,
          name: v.name,
          description: v.description,
          isSystem: true,
          ownerId: null,
          access: "company",
          definition: v.definition,
        });
      }
    }
  });
}
