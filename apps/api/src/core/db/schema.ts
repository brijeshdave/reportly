// Author: Brijesh Dave <https://github.com/brijeshdave>
// App-database schema (single file so drizzle-kit — which loads outside the TS
// path resolver — needs no cross-file imports). Grouped by domain: auth, org,
// access, settings, audit. System rows (isSystem) are immutable/non-deletable but
// clonable; that rule lives in the service layer (Step 5), not the DB.
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// --- shared column builders ---
const idPk = () => uuid("id").primaryKey().defaultRandom();

/** Postgres `bytea`. drizzle-orm has no first-class bytea, so it is declared once
 * here rather than cast at every call site. */
const customBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/**
 * The catalogue of job titles. Global, not per-company: a user is one record who may
 * sit in several companies and holds one job title, so a per-company catalogue would
 * have no single value to put on them.
 *
 * Users point at a row here rather than copying its name, so a rename corrects
 * everyone holding it at once and the usage count is a fact, not a guess about which
 * spellings meant the same job.
 */
export const designations = pgTable("designations", {
  id: idPk(),
  name: text("name").notNull().unique(),
  // Inactive means "no longer offered", never "gone": retiring a title must not
  // quietly strip it from the people who already hold it.
  status: text("status").notNull().default("active"),
  ...timestamps,
});

// --- auth (better-auth-managed + Reportly profile fields) ---
// better-auth owns id generation (Step 3 configures UUID strings); ids are `text`
// because better-auth inserts them directly.
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  // Login name — better-auth's username plugin owns these two: `username` is the
  // lowercased unique key it matches on, `display_username` what the user typed.
  username: text("username").notNull().unique(),
  displayUsername: text("display_username"),
  image: text("image"),
  avatarUrl: text("avatar_url"),

  // Contact channels. Only email is required. WhatsApp and Telegram are reached
  // through the mobile number, so they are flags on it; Discord is not
  // phone-addressable and carries its own handle. Each is verified separately —
  // a null timestamp means "not proven".
  mobile: text("mobile"),
  whatsappOnMobile: boolean("whatsapp_on_mobile").notNull().default(false),
  telegramOnMobile: boolean("telegram_on_mobile").notNull().default(false),
  discordHandle: text("discord_handle"),
  mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
  whatsappVerifiedAt: timestamp("whatsapp_verified_at", { withTimezone: true }),
  telegramVerifiedAt: timestamp("telegram_verified_at", { withTimezone: true }),
  discordVerifiedAt: timestamp("discord_verified_at", { withTimezone: true }),
  /**
   * When they last signed in successfully.
   *
   * Stored rather than derived from `sessions`: those rows are deleted on sign-out
   * and on expiry, so a derived "last seen" would read "never" for everybody who
   * signs out properly.
   */
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

  // Set when an administrator chose the password: the person must replace it
  // before they can use the app, so an admin-known password is never a working
  // credential for long.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  // The single status model. better-auth's admin plugin brought its own `role`
  // and `banned` columns, which authorized a parallel admin surface and
  // contradicted this one; the plugin is unmounted and the columns are gone.
  status: text("status").notNull().default("active"),
  // Job title, from the designations catalogue. Distinct from a department HOD role.
  // Set null on delete — but the service refuses to delete one that is in use, so
  // this is a backstop rather than the usual path.
  designationId: uuid("designation_id").references(() => designations.id, {
    onDelete: "set null",
  }),
  // The organisation's own identifier for the person; free-form, not unique.
  employeeId: text("employee_id"),
  // Whether this person is ranked on the leaderboard. On by default; turn it off for
  // someone who should not compete (a manager who only reviews, a service account),
  // and their points are left out of the standings entirely.
  countsOnLeaderboard: boolean("counts_on_leaderboard").notNull().default(true),
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  /**
   * When two-factor first became compulsory for this person — what the grace period
   * counts from. NULL while it does not apply. Per person rather than per setting
   * change, so somebody added to a required group months later gets their own days
   * to enrol rather than inheriting an expired deadline.
   */
  twoFactorRequiredSince: timestamp("two_factor_required_since", { withTimezone: true }),
  ...timestamps,
});

/**
 * A user's uploaded profile picture, as bytes.
 *
 * In the database rather than on disk because both containers run with a read-only
 * root filesystem — a file would need a volume or an object store, which is new
 * infrastructure to run and to back up. Here it rides along with the backup that
 * already exists.
 *
 * The browser resizes to 256px before uploading, so a row is tens of kilobytes, not
 * megabytes. Its own table, not a column on `users`: nothing that lists people
 * should have to drag image bytes through the query.
 */
export const userAvatars = pgTable("user_avatars", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  bytes: customBytea("bytes").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ...timestamps,
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  ...timestamps,
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...timestamps,
});

export const twoFactors = pgTable("two_factors", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").notNull().default(true),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

/**
 * A pending one-time code proving a contact channel. The code is stored hashed —
 * it is a credential for the lifetime it has, and the log/audit trail must never
 * be able to replay one. `destination` is recorded with it so that changing the
 * address (a new mobile, say) cannot be confirmed by a code sent to the old one.
 */
export const channelVerifications = pgTable(
  "channel_verifications",
  {
    id: idPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    destination: text("destination").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("channel_verifications_user_channel_idx").on(t.userId, t.channel, t.createdAt)],
);

// --- org ---
export const companies = pgTable("companies", {
  id: idPk(),
  name: text("name").notNull(),
  // Deleting a company cascades into its locations (and through them, into every
  // group scoped to one). Deactivating retires it without destroying anything.
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const locations = pgTable(
  "locations",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isRemote: boolean("is_remote").notNull().default(false),
    // Deactivating keeps every group scope that points at this location intact;
    // deleting would drop them. Prefer deactivating a location that has history.
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [unique("locations_company_name_unique").on(t.companyId, t.name)],
);

// Departments belong to a company and nest into a tree via `parentId`. Deleting a
// company cascades into its departments; deleting a parent department re-roots its
// children (set null) rather than silently destroying a whole subtree — the
// service still guards a delete that has children or members. Names are unique per
// company, like locations.
export const departments = pgTable(
  "departments",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => departments.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    unique("departments_company_name_unique").on(t.companyId, t.name),
    index("departments_company_parent_idx").on(t.companyId, t.parentId),
  ],
);

/**
 * A user's membership of a department, and their place in the reporting line.
 *
 * `reportsToId` is the hierarchy — the one stored fact that says who is above
 * whom, and the thing report visibility is computed from. It may cross
 * departments on purpose: the Head of Engineering reports to someone in
 * Management, not to anybody inside Engineering. A null means nobody is above
 * them (the top of a chain).
 *
 * `rank` is a *label* — Head of Department, team lead, member. It is not what
 * decides who can see whose reports: inferring authority from a job title, while
 * an explicit reporting line sits right beside it, is how the two come to
 * disagree. The chain decides; the rank describes.
 */
export const departmentUsers = pgTable(
  "department_users",
  {
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rank: text("rank").notNull().default("member"),
    /**
     * Travelling staff: a general shift, and a different plant on different days.
     * They are rostered on the department's *central* rota rather than any site's.
     *
     * Explicit, never inferred from "covers no sites" — an empty site set already
     * means *all* sites everywhere else, so inferring it would quietly reclassify
     * anybody an administrator had not finished placing.
     */
    isCentral: boolean("is_central").notNull().default(false),
    // Set null, not cascade: losing a manager must orphan the people under them,
    // visibly, rather than delete them along with the edge.
    reportsToId: text("reports_to_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.departmentId, t.userId] }),
    index("department_users_user_idx").on(t.userId),
    // The downline walk follows this edge; it is the hot path for report scoping.
    index("department_users_reports_to_idx").on(t.reportsToId),
  ],
);

/**
 * The sites a membership covers. Empty means "all of them" — a team lead who runs
 * Mumbai and Pune has two rows; one who runs the whole department has none.
 *
 * Sites hang off the *membership*, not the department: Engineering is Engineering
 * everywhere, and duplicating a department per site would fork the org chart and
 * leave a lead who spans two sites heading two departments.
 */
export const departmentUserLocations = pgTable(
  "department_user_locations",
  {
    departmentId: uuid("department_id").notNull(),
    userId: text("user_id").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.departmentId, t.userId, t.locationId] }),
    foreignKey({
      columns: [t.departmentId, t.userId],
      foreignColumns: [departmentUsers.departmentId, departmentUsers.userId],
      name: "department_user_locations_membership_fk",
    }).onDelete("cascade"),
  ],
);

// --- reports config (Phase 5) ---
// Global severity ladder — how serious an issue is, ordered low to high. It
// carries no weight: scoring is a fixed pot per entry and never multiplies by
// severity.
export const severities = pgTable("severities", {
  id: idPk(),
  name: text("name").notNull().unique(),
  orderIndex: integer("order_index").notNull().default(0),
  /**
   * The most one entry at this severity may be worth, shared among whoever worked
   * it. Ten for every severity until somebody says otherwise, which is what the
   * app did before this existed.
   */
  maxPoints: numeric("max_points", { precision: 4, scale: 1 }).notNull().default("10"),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

// Global status workflow. `group` (open/resolved/rejected) is what the engine reads;
// the name is the organisation's to choose.
export const journalStatuses = pgTable("journal_statuses", {
  id: idPk(),
  name: text("name").notNull().unique(),
  group: text("group").notNull().default("open"),
  isTerminal: boolean("is_terminal").notNull().default(false),
  orderIndex: integer("order_index").notNull().default(0),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

// Per-department categories. Names are unique within a department, not across the
// company — two departments may each have "Safety" and mean different things.
export const categories = pgTable(
  "categories",
  {
    id: idPk(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [unique("categories_department_name_unique").on(t.departmentId, t.name)],
);

/**
 * What kind of thing a device is — Pump, Sensor, Valve. Per department, like
 * categories: two departments may each keep a "Pump" and mean their own, so the
 * uniqueness is on (department, name) rather than global.
 *
 * Retiring a type set-nulls it off the devices holding it rather than deleting
 * them, so the register survives a vocabulary change.
 */
export const deviceTypes = pgTable(
  "device_types",
  {
    id: idPk(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Off by default: a dead PC is a job to do, not an outage to measure. Switch
    // it on for the devices that genuinely halt something.
    tracksDowntime: boolean("tracks_downtime").notNull().default(false),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [unique("device_types_department_name_unique").on(t.departmentId, t.name)],
);

/**
 * A free label for finding work later. Department-scoped and multi-select, which
 * is what separates it from a category: a report has exactly one category (what
 * kind of problem it is) and any number of tags (everything else you might search
 * by). Two departments may both keep "leak" and mean their own.
 */
export const tags = pgTable(
  "tags",
  {
    id: idPk(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // A hex colour, always set — the service picks one from the shared palette
    // when the caller does not choose. The default here is only a backstop for a
    // direct insert; it keeps the column NOT NULL without a two-step migration.
    color: text("color").notNull().default("#64748b"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [unique("tags_department_name_unique").on(t.departmentId, t.name)],
);

/**
 * What carries a tag. Polymorphic over reports and tasks, following the same
 * `owner_type` + `owner_id` shape `attachments` already uses — one link table
 * rather than a near-identical one per owner.
 *
 * Cascading on the tag means deleting a tag removes its links, which is why the
 * service retires rather than deletes one that is in use: the labels on historical
 * records are part of the record.
 */
export const taggables = pgTable(
  "taggables",
  {
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.tagId, t.ownerType, t.ownerId] }),
    index("taggables_owner_idx").on(t.ownerType, t.ownerId),
  ],
);

// A report — a piece of work, or an issue/breakdown. Everyone files these; the
// reporting line decides who scores them. All the config foreign keys are
// `set null` on delete so retiring a severity/status/category never destroys a
// report — the service refuses those deletes anyway once a report references them.
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("draft"),
    title: text("title").notNull(),

    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    severityId: uuid("severity_id").references(() => severities.id, { onDelete: "set null" }),
    statusId: uuid("status_id").references(() => journalStatuses.id, { onDelete: "set null" }),
    // Where the work happened. Nullable in the DB so the reports filed before this
    // column existed stay valid; the API requires it on *new* reports, so the
    // guarantee holds going forward without rewriting history.
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),

    reportDate: timestamp("report_date", { withTimezone: true }).notNull().defaultNow(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),

    issueSummary: text("issue_summary"),
    issueDetail: text("issue_detail"),
    rootCause: text("root_cause"),
    preventiveMeasures: text("preventive_measures"),
    workSummary: text("work_summary"),
    workDetail: text("work_detail"),

    recurrenceOfId: uuid("recurrence_of_id").references((): AnyPgColumn => journalEntries.id, {
      onDelete: "set null",
    }),

    // The task this work was logged against, when it came from one. Set null on
    // delete: removing the task must not take the record of the work with it —
    // the report is what the appraisal is attached to. Declared lazily because
    // `tasks` is defined further down the file.
    taskId: uuid("task_id").references((): AnyPgColumn => tasks.id, { onDelete: "set null" }),

    // Who is working this now. Distinct from `author_id`, which never changes: the
    // author filed it, the assignee holds it. Set null on delete so a departed
    // colleague leaves the report unassigned rather than taking it with them.
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),

    // Set on first appraisal — content edits are refused while it stands, so a mark
    // is never for work that changed after it was given.
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    // Rejection by a head-of-department: strikes the entry from scoring. When set, its
    // scores and awards are cleared and it may not be scored until un-rejected.
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedById: text("rejected_by_id").references(() => users.id, { onDelete: "set null" }),
    rejectionReason: text("rejection_reason"),
    /**
     * Where the entry stood before it was rejected, so lifting the rejection puts
     * it back. Guessing "Resolved" would be wrong for anything rejected while
     * still in progress.
     */
    rejectedFromStatusId: uuid("rejected_from_status_id").references(() => journalStatuses.id, {
      onDelete: "set null",
    }),

    // Set when the status changed while the points period was locked — the points must
    // be re-evaluated, and may be re-scored despite the lock until they are.
    pointsReviewNeeded: boolean("points_review_needed").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("reports_company_author_idx").on(t.companyId, t.authorId),
    index("reports_author_state_idx").on(t.authorId, t.state),
    index("reports_location_idx").on(t.locationId),
  ],
);

/**
 * One score of one worker on a report. Two tiers only: the worker's own split
 * (`self`) and a single management review (`review`) entered by their reporting
 * manager. Points are real numbers in 0.5 steps; the review, when present, is the
 * worker's official figure, otherwise the self number stands.
 *
 * Scores exist only while a report is resolved. Re-opening it deletes every row —
 * points are for finished work, so a report back in progress has none until it is
 * resolved and scored again.
 */
export const journalScores = pgTable(
  "journal_scores",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    // The worker being scored — a participant on the report.
    subjectUserId: text("subject_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(), // 'self' | 'review'
    // Who entered this score — the author for `self`, a manager for `review`.
    raterId: text("rater_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    points: real("points").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.subjectUserId, t.tier] }),
    index("report_scores_report_idx").on(t.reportId),
    index("report_scores_subject_idx").on(t.subjectUserId),
  ],
);

/**
 * Every change a report's points ever made. Append-only: one row per (subject, tier)
 * whenever their points are set, cleared (reopen/reject), or the person is dropped, so
 * the Points tab can show who changed what, when, and old → new. Distinct from
 * journal_scores (the current grid) and audit_events (coarse actions).
 */
export const journalScoreEvents = pgTable(
  "journal_score_events",
  {
    id: idPk(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    subjectUserId: text("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    tier: text("tier").notNull(), // 'self' | 'review'
    // Who made the change.
    raterId: text("rater_id").references(() => users.id, { onDelete: "set null" }),
    oldPoints: real("old_points"),
    newPoints: real("new_points"),
    reason: text("reason").notNull(), // score | reopened | rejected | removed | status-change
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("journal_score_events_report_idx").on(t.reportId)],
);

/**
 * Every move a report's status ever made. Append-only: one row per transition,
 * plus one at creation (`from_status_id` NULL) so the clock has a start — without
 * it a report that opened and closed would show a resolution time of nothing.
 *
 * This is the *only* record of response and resolution time; neither is stored on
 * `reports`. A derived column would be a second copy of a fact free to drift from
 * the events that produced it, which is the shape that has bitten this codebase
 * twice already. Reading them costs a small aggregate — worth it.
 *
 * Not `entity_history`, which was the original plan: that table records only
 * *changes*, so creation writes nothing and the clock never starts; it stores
 * values stringly-typed in a generic shape; and it is an audit surface with its own
 * retention, so pruning audit would quietly rewrite reliability history.
 *
 * `to_status_id` is nullable and set-null, like every other config link on a
 * report: retiring a status must never destroy the record that a report once
 * passed through it.
 */
export const journalStatusEvents = pgTable(
  "journal_status_events",
  {
    id: idPk(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    fromStatusId: uuid("from_status_id").references(() => journalStatuses.id, {
      onDelete: "set null",
    }),
    toStatusId: uuid("to_status_id").references(() => journalStatuses.id, { onDelete: "set null" }),
    changedBy: text("changed_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The timeline read and every timing aggregate walk one report's events in
    // order; this index is what keeps that from being a sort per report.
    index("report_status_events_report_idx").on(t.reportId, t.changedAt),
  ],
);

/**
 * A conversation on a record — a report or a task.
 *
 * Polymorphic over both, following the `owner_type` + `owner_id` shape
 * `attachments` established, so there is one comments feature rather than two
 * near-identical ones.
 *
 * Deliberately NOT frozen by a report's content lock. The lock exists so a mark is
 * never given for work that changed underneath it; a conversation is not the work,
 * and a locked report is exactly when people most need to discuss it. Same
 * reasoning as downtime staying closable after appraisal.
 *
 * `parent_id` allows one level of reply. It costs nothing to carry now and would
 * be a migration to add later.
 */
export const comments = pgTable(
  "comments",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => comments.id, {
      onDelete: "cascade",
    }),
    // Set when the author revises their own comment, so a reader can tell an
    // edited remark from the one people replied to.
    editedAt: timestamp("edited_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("comments_owner_idx").on(t.ownerType, t.ownerId, t.createdAt),
    index("comments_author_idx").on(t.authorId),
  ],
);

/**
 * Everyone who worked a report, and how the points divide between them.
 *
 * `weight` is a share of one fixed pot, not a multiplier: a report worth ten points
 * is worth ten however many people worked it. Two people on 1 and 1 take five each;
 * on 3 and 1 they take seven and a half and two and a half. That keeps the total a
 * report can ever be worth a property of the work, not of how many names are on it.
 *
 * The author is inserted here when the report is created, so the maths has no
 * special case for them — they are simply the first participant. A report with no
 * rows here (every one filed before this existed) is treated as "author takes all",
 * which is exactly what it was.
 */
export const journalParticipants = pgTable(
  "journal_participants",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedBy: text("added_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.userId] })],
);

/**
 * Every time a report changed hands. Append-only, exactly like
 * `report_status_events`: who held it, who has it now, who moved it and why.
 *
 * There is no update or delete path. A handover that happened cannot un-happen,
 * and "who was responsible at the time" is the question this table exists to
 * answer months later.
 */
export const journalHandovers = pgTable(
  "journal_handovers",
  {
    id: idPk(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    // Null on the first assignment: nobody held it before.
    fromUserId: text("from_user_id").references(() => users.id, { onDelete: "set null" }),
    // Null when a report is deliberately handed back to nobody.
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "set null" }),
    byUserId: text("by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    handedAt: timestamp("handed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_handovers_report_idx").on(t.reportId, t.handedAt)],
);

/**
 * What was actually done, item by item, in the order it happened.
 *
 * A journal entry has one pair of `work_summary`/`work_detail` columns, which is fine
 * for "here is what I did" and useless for a job worked over two shifts by three
 * people: one text field has nowhere to put a *time*, and appending to it turns a
 * record into a run-on paragraph. So the work is its own rows.
 *
 * `user_id` is who did the work, not who typed it — a colleague's item belongs to
 * them, and is theirs to correct. `started_at`/`finished_at` are when the work
 * happened; `created_at` is when it was written down, which is often later and is a
 * different fact.
 */
export const journalWorkLogs = pgTable(
  "journal_work_logs",
  {
    id: idPk(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    detail: text("detail"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  // Ordered by when the work happened, falling back to when it was written: an item
  // logged without times still has a place in the timeline.
  (t) => [index("work_logs_report_idx").on(t.reportId, t.startedAt, t.createdAt)],
);

/**
 * The frozen points ledger — immutable award rows, like bank transactions. Each
 * worker is credited their *official* score (kind = direct); every manager above
 * them earns a decaying share of it (kind = rollup, depth = how far above). Rows
 * are rebuilt only for the one report being (re)scored, using the weightage in
 * force at that moment, and every figure is rounded to a 0.5 step. Re-opening a
 * report clears its rows — points are for finished work.
 */
/**
 * The points ledger, read by the leaderboard and by "my points". Once tied only to a
 * journal entry, it is now source-aware: journal scores and routine completions both
 * write here. `companyId` / `earnedOn` / `departmentId` are carried on the row itself
 * (back-filled for journal awards from their entry), so the leaderboard reads the ledger
 * directly without joining the journal — which is what lets a non-journal source
 * (`routine`) contribute points. `reportId` is set for `journal` awards only.
 */
export const pointAwards = pgTable(
  "point_awards",
  {
    id: idPk(),
    beneficiaryUserId: text("beneficiary_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** The day the points count for — a journal entry's report date, or a routine's occurrence date. */
    earnedOn: date("earned_on").notNull(),
    /** For the by-department leaderboard. Null for sources with no department (routines). */
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    source: text("source").notNull().default("journal"), // 'journal' | 'routine' | 'service'
    reportId: uuid("report_id").references(() => journalEntries.id, { onDelete: "cascade" }),
    routineId: uuid("routine_id"),
    /** The refill or repair that earned it, when the source is a service. */
    serviceEventId: uuid("service_event_id"),
    /**
     * The award this one cancels.
     *
     * A reversal is a new row with negative points pointing at the original, never
     * a delete or an edit. The ledger is frozen by design, and a score that changes
     * with nothing to show for it is worse than one showing an award and its
     * reversal side by side.
     */
    reversesAwardId: uuid("reverses_award_id"),
    kind: text("kind").notNull(), // 'direct' | 'rollup'
    depth: integer("depth").notNull().default(0),
    points: real("points").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("point_awards_beneficiary_idx").on(t.beneficiaryUserId),
    index("point_awards_report_idx").on(t.reportId),
    index("point_awards_company_earned_idx").on(t.companyId, t.earnedOn),
  ],
);

// --- master lists (Phase 5, Step 3) ---
// The configurable vocabulary for the asset tree. Global, so an organisation names
// its own structure once — Line/Station for a factory, Ward/Bed for a hospital.
export const assetTypes = pgTable("asset_types", {
  id: idPk(),
  name: text("name").notNull().unique(),
  orderIndex: integer("order_index").notNull().default(0),
  // Whether an outage on something of this kind is worth recording. True here
  // and false on device types: assets are the production structure, the device
  // register is mostly desks and laptops.
  tracksDowntime: boolean("tracks_downtime").notNull().default(true),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

// The structural few — plant, lines, stations, buildings, areas. A per-company
// nested tree, like departments. Names are *not* unique: "Station 1" recurs under
// every line. Deleting a parent orphans its children (set null) rather than
// cascading them away; the service refuses deleting an asset still in use.
export const assets = pgTable(
  "assets",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => assets.id, { onDelete: "set null" }),
    typeId: uuid("type_id").references(() => assetTypes.id, { onDelete: "set null" }),
    // The site this thing physically stands at. Nullable = not placed yet, and an
    // unplaced asset is visible to every location scope — unplaced is not secret.
    // Set null on delete: retiring a site must not delete the machines standing in
    // it. This is the ONE stored location in the reports domain; devices and
    // reports carry their own, everything else derives.
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    index("assets_company_parent_idx").on(t.companyId, t.parentId),
    index("assets_location_idx").on(t.locationId),
  ],
);

// The many — machines, sensors. A flat, searchable registry, never a hand-built
// tree. Each optionally records where it lives (an asset) so "issues under Line 3"
// still rolls up its devices, and which department owns it.
export const devices = pgTable(
  "devices",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Free text: a serial number, a vendor code, whatever is stamped on it.
    identifier: text("identifier"),
    // The organisation's own asset ID — unique within the company, so it can be
    // used to look a device up. Nullable because not every device has one yet, and
    // a NOT NULL here would block registering the ones that do not.
    assetTag: text("asset_tag"),
    typeId: uuid("type_id").references(() => deviceTypes.id, { onDelete: "set null" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    // Its own site rather than one inherited through `assetId`: a device is
    // registered before it is placed, and the user picks its location directly.
    // Where both are set the asset's location wins for roll-up, and the UI shows
    // the disagreement rather than silently reconciling it.
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    index("devices_company_idx").on(t.companyId),
    index("devices_location_idx").on(t.locationId),
    unique("devices_company_asset_tag_unique").on(t.companyId, t.assetTag),
  ],
);

// What a report is about — its scope. Polymorphic: a kind ('asset'|'device'|'user'
// |'department') and the id of the thing. No foreign key on `target_id` because it
// spans four tables; the service resolves labels and drops stale links.
export const journalTargets = pgTable(
  "journal_targets",
  {
    reportId: uuid("report_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.targetKind, t.targetId] }),
    index("report_targets_target_idx").on(t.targetKind, t.targetId),
  ],
);

// How long a thing was down — a separate clock from the report's work time. Raised
// from a report against one of its scope targets; `ended_at` null = still open,
// which is what the pending-downtime queue lists and what keeps a per-thing total
// climbing until it is closed.
export const downtimeEntries = pgTable(
  "downtime_entries",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    reportId: uuid("report_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    targetKind: text("target_kind").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    index("downtime_company_target_idx").on(t.companyId, t.targetKind, t.targetId),
    index("downtime_report_idx").on(t.reportId),
  ],
);

// --- tasks (Phase 5, Step 5) ---
/**
 * Work handed to somebody — the intent, where a report is the record.
 *
 * `assignerId` is set null rather than cascaded on delete: losing the person who
 * handed the work out must not delete the work. The assignee cascades, because a
 * task with nobody to do it is not a task.
 *
 * `state` is a small fixed set rather than a link to the configurable report-status
 * catalogue: a task and a report have different lifecycles, and sharing one list
 * would leak each one's vocabulary into the other's picker.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    detail: text("detail"),
    assignerId: text("assigner_id").references(() => users.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: text("priority").notNull().default("normal"),
    state: text("state").notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("tasks_state_idx").on(t.state), index("tasks_company_idx").on(t.companyId)],
);

// Who is on a task. A task may have several people or nobody at all: work is
// planned before it is handed out, split across a team, and handed over when a
// shift ends. One row per person is the only shape that says all three.
export const taskAssignees = pgTable(
  "task_assignees",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Set when the person hands the task on. They stay a row rather than being
    // deleted, because the points for a task handed over mid-shift are split
    // between both people, and a deleted row cannot be paid.
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    // The "my tasks" read: what is on one person's plate.
    index("task_assignees_user_idx").on(t.userId),
  ],
);

// Why a task changed hands, in the shape journal handovers already use. A task
// moved at the end of a shift is a fact about the work, not a silent edit to a
// row, and the person who asked for the move belongs in the record.
export const taskHandovers = pgTable(
  "task_handovers",
  {
    id: idPk(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "set null" }),
    byUserId: text("by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason"),
    handedAt: timestamp("handed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_handovers_task_idx").on(t.taskId, t.handedAt)],
);

// --- attachments (Phase 5, Step 4) ---
/**
 * A file hanging off a record. Metadata only — the bytes live in whichever storage
 * backend was configured when it was uploaded.
 *
 * `backend` and `key` are stored per row rather than derived from today's
 * configuration: a file uploaded to local disk stays on local disk when the backend
 * is switched to S3, until `cli storage:migrate` moves it and rewrites the row.
 * Deriving the location from the current setting would lose every existing file the
 * moment somebody changed it.
 *
 * The owner link is polymorphic (report today, task next), so there is no foreign
 * key; the service deletes a record's files with it.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    backend: text("backend").notNull(),
    key: text("key").notNull(),
    checksum: text("checksum").notNull(),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    index("attachments_owner_idx").on(t.ownerType, t.ownerId),
    index("attachments_company_idx").on(t.companyId),
  ],
);

// --- access model ---
export const groups = pgTable("groups", {
  id: idPk(),
  name: text("name").notNull().unique(),
  isSystem: boolean("is_system").notNull().default(false),
  /**
   * Everybody in this group must enrol in two-factor. On the group, not the role:
   * a role says what you may do, this says how you must prove who you are.
   */
  requiresTwoFactor: boolean("requires_two_factor").notNull().default(false),
  ...timestamps,
});

export const roles = pgTable("roles", {
  id: idPk(),
  name: text("name").notNull().unique(),
  isSystem: boolean("is_system").notNull().default(false),
  ...timestamps,
});

export const permissions = pgTable("permissions", {
  id: idPk(),
  // Stable `resource:action` key from @reportly/shared PERMISSIONS.
  key: text("key").notNull().unique(),
  description: text("description"),
  ...timestamps,
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })],
);

export const groupRoles = pgTable(
  "group_roles",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.roleId] })],
);

export const groupUsers = pgTable(
  "group_users",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

/**
 * Where a person may work. Scope belongs to the **person**, not to the group: a
 * group answers "what may you do" (it is a bundle of roles), and the user record
 * answers "and where" — the company they may open, and the sites within it.
 *
 * These used to hang off the group, which meant moving somebody between sites
 * required a new group, and two people who did the same job at different plants
 * could not share one.
 */
export const userCompanies = pgTable(
  "user_companies",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.companyId] })],
);

/** No rows for a user means "every location of the companies they may open". */
export const userLocations = pgTable(
  "user_locations",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.locationId] })],
);

// --- report views: saved report definitions (Phase 6, reports domain) ---

/**
 * A saved report shape — its range, grouping, columns and filters — run against the
 * journal on demand. Nothing here is an aggregate: the `definition` is the recipe,
 * and the rows are recomputed (and re-scoped to the caller) on every run.
 *
 * `is_system` views are the ones seeded with the app; they carry a null company and
 * null owner and show in every company, and the service refuses to edit or delete
 * them — they may only be run or cloned. A clone is an ordinary row with a company,
 * an owner, and `is_system=false`.
 */
export const reportViews = pgTable(
  "report_views",
  {
    id: idPk(),
    // Null for a system view (global); set for a company's own custom view.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    // Who built it; null on system views. Set null on delete so a departed owner
    // leaves the (possibly shared) view standing rather than taking it with them.
    ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
    // private | company | groups — who the view is offered to. Row scope is separate.
    access: text("access").notNull().default("private"),
    // The report definition (range, grouping, columns, filters) as one JSON blob.
    definition: jsonb("definition").notNull(),
    ...timestamps,
  },
  (t) => [index("report_views_company_idx").on(t.companyId)],
);

/** The groups a `groups`-access report view is shared with. */
export const reportViewGroups = pgTable(
  "report_view_groups",
  {
    reportViewId: uuid("report_view_id")
      .notNull()
      .references(() => reportViews.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.reportViewId, t.groupId] })],
);

// --- settings (table only in Step 2; framework in Phase 2) ---
export const settings = pgTable(
  "settings",
  {
    id: idPk(),
    namespace: text("namespace").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    // 'system' | 'company' | 'user'. Exactly one of the two id columns is set,
    // and for 'system' neither is — see core/settings/repo.ts, where the owner is
    // a union precisely so the other combinations cannot be written.
    scope: text("scope").notNull().default("system"),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("settings_scope_key_unique").on(t.namespace, t.key, t.scope, t.userId, t.companyId),
  ],
);

// --- audit + change history (tables only in Step 2; wired in Phase 2) ---
export const auditEvents = pgTable("audit_events", {
  id: idPk(),
  action: text("action").notNull(),
  actorId: text("actor_id"),
  companyId: uuid("company_id"),
  ip: text("ip"),
  requestId: text("request_id"),
  details: jsonb("details"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What Reportly sent out, and whether it arrived.
 *
 * `destination` is stored **redacted** — the row never holds the address at all,
 * so it cannot leak one later. The message body is never stored: a reset email
 * carries a working link, and a log of those is a second front door.
 */
export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: idPk(),
    channel: text("channel").notNull(),
    kind: text("kind").notNull(),
    /** The notification type, when the kind is `notification`. */
    eventType: text("event_type"),
    // text, not uuid: better-auth owns the users table and its ids are text.
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Null for a message about the installation rather than one company. */
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    destination: text("destination").notNull(),
    subject: text("subject"),
    status: text("status").notNull().default("queued"),
    /** The provider's own refusal, verbatim. */
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outbound_messages_queued_at_idx").on(table.queuedAt.desc()),
    index("outbound_messages_to_user_idx").on(table.toUserId, table.queuedAt.desc()),
    index("outbound_messages_channel_status_idx").on(table.channel, table.status),
    index("outbound_messages_company_idx").on(table.companyId, table.queuedAt.desc()),
  ],
);

export const entityHistory = pgTable("entity_history", {
  id: idPk(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  field: text("field").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  actorId: text("actor_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Previous password hashes, newest first by `createdAt`. Two settings need it:
 * `reuseCount` (a new password must not match the last N) and `expiryDays` (the
 * newest row is when the password was last set).
 */
export const passwordHistory = pgTable(
  "password_history",
  {
    id: idPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_history_user_created_idx").on(t.userId, t.createdAt)],
);

// --- shift & schedule management ---

/**
 * A named shift a department runs on — Morning, Night, and so on. Times are stored
 * as minutes from local midnight (0–1439), not clock strings, so the maths for
 * overlap and duration is plain arithmetic. An overnight shift wraps midnight, which
 * shows as `endMinute <= startMinute` (e.g. 1320→360 for 22:00–06:00). Definitions
 * are company-wide and reused across departments; the per-department planning lives
 * in `schedules`. `disabled` retires a shift without deleting the history that used
 * it, mirroring designations.
 */
export const shifts = pgTable(
  "shifts",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // 1–2 char calendar code (G, A, …) so every cell is the same width; and a colour
    // from a fixed palette so shifts are told apart at a glance.
    code: text("code").notNull(),
    color: text("color").notNull().default("slate"),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    /**
     * The weekdays this shift is expected to be staffed, 0 = Sunday.
     *
     * Coverage only calls a shift uncovered on a day it actually runs. A general
     * shift that is off on Sundays was otherwise reported missing every Sunday for
     * ever, and a warning that is always wrong is one nobody reads.
     */
    runsOnDays: integer("runs_on_days").array().notNull().default([0, 1, 2, 3, 4, 5, 6]),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [unique("shifts_company_name_unique").on(t.companyId, t.name)],
);

/**
 * A department's roster for one month — the container the calendar hangs its cells
 * on. One per (department, year, month). `draft` while it is being built; `published`
 * freezes a baseline (each entry's `planned*` is set to what it then held), after
 * which an approved swap moves the live assignment while the baseline stays put — the
 * gap between the two is exactly the "scheduled vs actual" the calendar shows.
 */
export const schedules = pgTable(
  "schedules",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    /**
     * The site this rota is for. **NULL is meaningful**: it is the *central* rota,
     * for people who travel rather than belong to one site. The uniqueness below
     * therefore treats NULLs as equal, or a department could hold any number of
     * central rotas for one month.
     */
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // A locked schedule is frozen against direct edits — only approved swaps move it —
    // and only a Head of Department can unlock it again.
    locked: boolean("locked").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique("schedules_dept_site_month_unique")
      .on(t.departmentId, t.locationId, t.year, t.month)
      .nullsNotDistinct(),
    index("schedules_location_idx").on(t.locationId),
  ],
);

/**
 * One cell of the roster: a person, a day, and the shift they are on — or an explicit
 * Off/Leave (`state`, with a null `shiftId`). A person may hold two rows on a day only
 * for a genuine, non-overlapping double shift; the service enforces that. `plannedShiftId`
 * and `plannedState` are the frozen baseline captured at publish (null while draft),
 * so an approved swap can move `shiftId`/`state` while the plan stays legible beside it.
 */
export const scheduleEntries = pgTable(
  "schedule_entries",
  {
    id: idPk(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // A deleted shift blanks the cell rather than deleting the roster row, so the
    // day is visibly uncovered rather than silently gone.
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    state: text("state").notNull().default("working"),
    plannedShiftId: uuid("planned_shift_id").references(() => shifts.id, { onDelete: "set null" }),
    plannedState: text("planned_state"),
    ...timestamps,
  },
  (t) => [
    index("schedule_entries_schedule_date_idx").on(t.scheduleId, t.date),
    index("schedule_entries_user_idx").on(t.userId),
  ],
);

/**
 * Where a central person was on a given day — "Plant A", or "Plant A + Plant B".
 *
 * An indication for whoever reads the rota, and nothing else: no hours, no halves,
 * nothing the system computes with. Deliberately a set rather than a column on the
 * cell, so a day covering two sites needs no second row and the grid keeps its one
 * cell per person per day.
 */
export const scheduleEntryLocations = pgTable(
  "schedule_entry_locations",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => scheduleEntries.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.locationId], name: "schedule_entry_locations_pk" }),
    index("schedule_entry_locations_location_idx").on(t.locationId),
  ],
);

/**
 * A colleague-swap request: two people, on the same day, asking to exchange their
 * shifts. It waits `pending` until the requester's reporting manager (or a scheduler)
 * decides; on `approved` the two entries trade shift/state, so the calendar's Actual
 * view diverges from the published plan. The entry references cascade — if either
 * cell is cleared the request is moot and goes with it.
 */
export const shiftSwapRequests = pgTable(
  "shift_swap_requests",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Set null, not cascade: approving with no swap deletes the requester's cell, but
    // the decided request must survive as the approver's record — so the entry ref is
    // nulled rather than taking the request row down with it.
    requesterEntryId: uuid("requester_entry_id").references(() => scheduleEntries.id, {
      onDelete: "set null",
    }),
    // Nullable: a request may only *suggest* a swap (or none at all); the approving
    // manager picks or confirms the colleague, and the final counterpart is written here.
    counterpartUserId: text("counterpart_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    counterpartEntryId: uuid("counterpart_entry_id").references(() => scheduleEntries.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    /**
     * Set when an approver deliberately allowed a swap between two sites. Refused
     * by default — the candidate list only offers the same rota — so this records
     * a decision somebody made, with their reason, rather than a quiet exception.
     */
    crossSite: boolean("cross_site").notNull().default(false),
    crossSiteReason: text("cross_site_reason"),
    status: text("status").notNull().default("pending"),
    approverUserId: text("approver_user_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("shift_swaps_schedule_idx").on(t.scheduleId),
    index("shift_swaps_requester_idx").on(t.requesterUserId),
    index("shift_swaps_status_idx").on(t.status),
  ],
);

/**
 * The history of how a published schedule was disturbed: a cell edited (from→to), a
 * swap approved or rejected, and the publish/lock lifecycle. One row per change, with
 * human labels resolved at write time so the log reads back — and reports read — without
 * re-joining, and stays accurate even if a shift is later renamed. Draft-building is not
 * logged; only changes to a plan people are already working to.
 */
export const scheduleChangeLog = pgTable(
  "schedule_change_log",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    // The day affected, null for schedule-level events (publish/lock).
    date: date("date"),
    // Whose cell changed, null for schedule-level events.
    subjectUserId: text("subject_user_id").references(() => users.id, { onDelete: "set null" }),
    // Who made the change.
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // assign | clear | swap | publish | lock | unlock | reject
    fromLabel: text("from_label"),
    toLabel: text("to_label"),
    swapId: uuid("swap_id").references(() => shiftSwapRequests.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("schedule_change_log_schedule_date_idx").on(t.scheduleId, t.date),
    index("schedule_change_log_created_idx").on(t.createdAt),
  ],
);

// --- team routines: recurring duties with per-person completion tracking ---

/**
 * A recurring duty a manager gives their team. The cadence + anchor define one expected
 * occurrence per period (daily = every day; weekly = `anchorWeekday`; monthly/quarterly
 * = `anchorDay`, with `anchorMonthOfQuarter` picking the month within a quarter).
 * `points` is what an on-time completion earns at month-end (half if late). Multiple
 * people may be assigned; an occurrence is covered if one or more of them complete it.
 */
export const routines = pgTable(
  "routines",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // The department the routine's points are credited to on the leaderboard — chosen
    // at creation from the creator's departments.
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    cadence: text("cadence").notNull(), // daily | weekly | monthly | quarterly
    anchorWeekday: integer("anchor_weekday"), // 0 (Sun) – 6, for weekly
    anchorDay: integer("anchor_day"), // 1–28, for monthly / quarterly
    anchorMonthOfQuarter: integer("anchor_month_of_quarter"), // 1–3, for quarterly
    points: real("points").notNull().default(1),
    startDate: date("start_date").notNull(),
    // Days after an occurrence's due day it may still be logged before it expires.
    graceDays: integer("grace_days").notNull().default(3),
    status: text("status").notNull().default("active"), // active | paused
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("routines_company_idx").on(t.companyId)],
);

/** The people a routine is assigned to — any of them may complete each occurrence. */
export const routineAssignees = pgTable(
  "routine_assignees",
  {
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.routineId, t.userId] }),
    index("routine_assignees_user_idx").on(t.userId),
  ],
);

/**
 * One person's record of doing a routine's occurrence: started, then finished with
 * optional notes (and files via the generic attachments). `awardedPoints` is set when
 * the month-end award runs, both to record what was earned and to make that idempotent.
 * One row per (routine, occurrence day, person).
 */
export const routineCompletions = pgTable(
  "routine_completions",
  {
    id: idPk(),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    occurrenceDate: date("occurrence_date").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("in_progress"), // in_progress | completed
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    notes: text("notes"),
    awardedPoints: real("awarded_points"),
    ...timestamps,
  },
  (t) => [
    unique("routine_completions_unique").on(t.routineId, t.occurrenceDate, t.userId),
    index("routine_completions_routine_date_idx").on(t.routineId, t.occurrenceDate),
    index("routine_completions_user_idx").on(t.userId),
  ],
);

/**
 * One notification, as the bell and the notifications page show it.
 *
 * The title and body are *rendered at emit time* rather than assembled on read.
 * A notification is a record of what was true when it was sent: if an entry is
 * renamed or a person leaves, the message that went out did not change, and a row
 * that re-derives its own wording would quietly rewrite history in the inbox.
 *
 * `company_id` carries the tenant for anything that belongs to one — a person can
 * sit in several companies and reads the bell under an active one, and SF-006 was
 * precisely a per-user surface that forgot which. NULL is a deliberate value, not
 * a missing one: it means the event concerns the installation (a failed backup, a
 * jammed queue), so the row is shown in every company context rather than hidden
 * in all of them. What decides whether a row is yours is `user_id`, which is not
 * nullable; the company only ever narrows the view.
 *
 * `link` is a route, not a URL. The client is the only thing that knows its own
 * origin, and a stored absolute URL breaks the day the app changes host.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: idPk(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    entityKind: text("entity_kind"),
    entityId: text("entity_id"),
    // Null for anything the system did on its own — a failed backup, a month-end
    // award. "Reportly" is not a person and should not be rendered as one.
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The bell polls the unread count on every client, so it is the one query
    // that must not touch rows it will not count.
    index("notifications_unread_idx").on(t.userId, t.companyId, t.readAt),
    index("notifications_inbox_idx").on(t.userId, t.companyId, t.createdAt),
  ],
);

/**
 * A record that a reminder has already gone out.
 *
 * Reminders are the one notification kind nothing in the app *does* — no click
 * causes them, a daily sweep notices a fact that is still true. So without a mark
 * they would fire every single day for the same overdue routine, which is how a
 * notification feature becomes the thing everyone filters to a folder.
 *
 * Keyed by the occurrence, not the thing: a routine due on the 3rd and the same
 * routine due on the 4th are two different reminders, and one being sent must not
 * silence the other.
 *
 * Deliberately separate from `notifications` rather than checking that table for
 * an existing row. A person who has switched the bell off for a type has no row
 * to find, and would be emailed daily for ever.
 */
export const notificationReminders = pgTable(
  "notification_reminders",
  {
    id: idPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    entityKind: text("entity_kind").notNull(),
    entityId: text("entity_id").notNull(),
    /** Which occurrence this was about — a date for a routine, the due date for a task. */
    occurrenceKey: text("occurrence_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("notification_reminders_unique").on(t.userId, t.type, t.entityId, t.occurrenceKey),
    index("notification_reminders_sent_idx").on(t.sentAt),
  ],
);

/**
 * A user's answer for one notification type on one channel.
 *
 * Overrides only. A (type, channel) a person has never touched is absent here and
 * follows the current system default — which is what makes "set the default for
 * everyone" work without a backfill, and what gives a type added to the catalogue
 * next year a sensible answer for someone who signed up this year.
 *
 * The consequence, stated so nobody is surprised by it: changing a default moves
 * every user who has not overridden that cell, not only accounts created
 * afterwards.
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: idPk(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("notification_preferences_unique").on(t.userId, t.type, t.channel),
    index("notification_preferences_user_idx").on(t.userId),
  ],
);

/* ------------------------------- rotables ---------------------------------- */
/*
 * Items with their own identity that cycle stock → installed → workshop → stock.
 * Printer cartridges today; the same shape as UPS batteries, filter units and
 * calibrated tools, which is why nothing below names toner.
 *
 * Company-scoped throughout. Two departments may each keep their own catalogue,
 * but a part never crosses a company — SF-006.
 */

/** What can be done to a part. A catalogue, so "Deep clean" needs no migration. */
export const serviceKinds = pgTable(
  "service_kinds",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** The fallback rate. A part model may pay differently — see serviceRates. */
    defaultPoints: real("default_points").notNull().default(0),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [unique("service_kinds_company_name_unique").on(t.companyId, t.name)],
);

/**
 * Something used up by a service: toner powder, an OPC drum, a wiper blade.
 *
 * A list of names and units. There is deliberately no quantity column here — no
 * opening balance, no receipts, no current level. This module records what a job
 * consumed and must never look like it knows what is left in the store.
 */
export const consumables = pgTable(
  "consumables",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("ea"), // 'ea' | 'g' | 'ml'
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [unique("consumables_company_name_unique").on(t.companyId, t.name)],
);

/** A kind of part: "HP 12A Toner". */
export const partModels = pgTable(
  "part_models",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    // Null means no limit, which is a real answer. Passing it warns and never
    // refuses: the maker's figure is an opinion, and refusing only teaches people
    // to re-register the part under a new identifier.
    cycleLimit: integer("cycle_limit"),
    // What one charge ought to produce. Null is a real answer too — plenty of
    // parts have no published figure, and a zero would read as "produces
    // nothing". Compared against, never enforced, exactly like the cycle limit.
    ratedPageYield: integer("rated_page_yield"),
    status: text("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [unique("part_models_company_name_unique").on(t.companyId, t.name)],
);

/**
 * What one kind of service may consume, and how much.
 *
 * A refill takes toner and nothing else; a repair takes drums and blades and
 * never toner. Without this the form offers the whole cupboard for both, and a
 * record ends up saying a refill fitted a drum.
 *
 * No rows for a kind means "not restricted yet" — everything offered, nothing
 * required — so the rule is additive over kinds that predate it.
 */
export const serviceKindConsumables = pgTable(
  "service_kind_consumables",
  {
    serviceKindId: uuid("service_kind_id")
      .notNull()
      .references(() => serviceKinds.id, { onDelete: "cascade" }),
    consumableId: uuid("consumable_id")
      .notNull()
      .references(() => consumables.id, { onDelete: "cascade" }),
    // `min` above zero makes it required: a refill that used no toner did not
    // happen. `max` null means no ceiling.
    minQuantity: real("min_quantity").notNull().default(0),
    maxQuantity: real("max_quantity"),
  },
  (t) => [primaryKey({ columns: [t.serviceKindId, t.consumableId] })],
);

/**
 * What a model fits.
 *
 * Against device *types* rather than individual devices, so registering a new
 * printer of a known type needs no compatibility work. Device types are
 * department-scoped, which is correct while all printers live under IT; if that
 * changes, a make/model column on devices replaces this join.
 */
export const partModelCompatibility = pgTable(
  "part_model_compatibility",
  {
    partModelId: uuid("part_model_id")
      .notNull()
      .references(() => partModels.id, { onDelete: "cascade" }),
    deviceTypeId: uuid("device_type_id")
      .notNull()
      .references(() => deviceTypes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.partModelId, t.deviceTypeId] })],
);

/** What one model pays for one kind of service, overriding the kind's default. */
export const partModelServiceRates = pgTable(
  "part_model_service_rates",
  {
    partModelId: uuid("part_model_id")
      .notNull()
      .references(() => partModels.id, { onDelete: "cascade" }),
    serviceKindId: uuid("service_kind_id")
      .notNull()
      .references(() => serviceKinds.id, { onDelete: "cascade" }),
    points: real("points").notNull(),
  },
  (t) => [primaryKey({ columns: [t.partModelId, t.serviceKindId] })],
);

/** One tracked unit — the thing with a label written on it. */
export const parts = pgTable(
  "parts",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    partModelId: uuid("part_model_id")
      .notNull()
      .references(() => partModels.id, { onDelete: "restrict" }),
    identifier: text("identifier").notNull(),
    // 'needs_service' | 'ready' | 'installed' | 'scrapped'. `ready` is the only
    // one a deploy accepts — see features/parts/parts-service.ts.
    status: text("status").notNull().default("needs_service"),
    cycleCount: integer("cycle_count").notNull().default(0),
    // Where it sits while in stock. Null once installed — the placement says where
    // it is then, and holding both invites them to disagree.
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    unique("parts_company_identifier_unique").on(t.companyId, t.identifier),
    index("parts_company_status_idx").on(t.companyId, t.status),
  ],
);

/**
 * One tour of duty, append-only.
 *
 * The part carries where it is now, because every list needs that cheaply. This
 * is where it has been — what answers "how long did that refill last" and "which
 * printer keeps eating cartridges".
 */
export const partPlacements = pgTable(
  "part_placements",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    installedBy: text("installed_by").references(() => users.id, { onDelete: "set null" }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: text("removed_by").references(() => users.id, { onDelete: "set null" }),
    // 'ok' | 'faulty', null while still installed. `faulty` is what triggers the
    // points reversal, so it is chosen at the moment of return rather than read
    // out of a note afterwards.
    outcome: text("outcome"),
    note: text("note"),
    // The host machine's counter at each end of the tour. Two readings rather
    // than one "pages printed", because whoever books the part in can read
    // today's counter and cannot know what it said weeks ago when it went in.
    // `pagesPrinted` is for a machine with no counter to read. All null-able:
    // null is "not known", never zero. Derived by `pagesFor()` in shared, which
    // is the only place the arithmetic lives.
    meterStart: integer("meter_start"),
    meterEnd: integer("meter_end"),
    pagesPrinted: integer("pages_printed"),
    ...timestamps,
  },
  (t) => [
    index("part_placements_part_idx").on(t.partId, t.installedAt),
    index("part_placements_device_idx").on(t.deviceId),
  ],
);

/** One refill or repair. */
export const serviceEvents = pgTable(
  "service_events",
  {
    id: idPk(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id, { onDelete: "cascade" }),
    serviceKindId: uuid("service_kind_id")
      .notNull()
      .references(() => serviceKinds.id, { onDelete: "restrict" }),
    performedBy: text("performed_by").references(() => users.id, { onDelete: "set null" }),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    /** What it paid, for display. The ledger stays the truth. */
    points: real("points").notNull().default(0),
    /** Set when a failure inside the window reversed it. Reversed once, never twice. */
    pointsReversedAt: timestamp("points_reversed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("service_events_part_idx").on(t.partId, t.performedAt)],
);

/** A line on a service event: 90g of toner, one drum. */
export const serviceConsumptions = pgTable(
  "service_consumptions",
  {
    id: idPk(),
    serviceEventId: uuid("service_event_id")
      .notNull()
      .references(() => serviceEvents.id, { onDelete: "cascade" }),
    consumableId: uuid("consumable_id")
      .notNull()
      .references(() => consumables.id, { onDelete: "restrict" }),
    quantity: real("quantity").notNull(),
  },
  (t) => [index("service_consumptions_event_idx").on(t.serviceEventId)],
);

// A recorded backup — a database dump or a files archive written through the storage
// layer. The row is the catalogue the Backups page lists and restores from; the bytes
// live under a `backups/` key. `created_by` is null for a scheduled run.
export const backups = pgTable(
  "backups",
  {
    id: idPk(),
    kind: text("kind").notNull(), // 'database' | 'files'
    storageKey: text("storage_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("completed"), // 'completed' | 'failed'
    error: text("error"),
    /**
     * What the attempt said — the tool's own output, redacted, capped.
     *
     * Kept on the row rather than left to the log database, which is switchable
     * and pruned: the reason a backup failed three weeks ago should still be
     * readable today, next to the attempt it belongs to.
     */
    log: text("log"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("backups_kind_created_idx").on(t.kind, t.createdAt)],
);
