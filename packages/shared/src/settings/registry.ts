// Author: Brijesh Dave <https://github.com/brijeshdave>
// The settings registry: every configurable setting is declared here once, with
// its Zod schema, scope rules, and (implicitly) its defaults. API validates writes
// against these; web renders forms from them. Every field carries a default, so
// `schema.parse({})` yields the setting's default value.
import { z } from "zod";

import { notificationMatrixSchema } from "@/entities/notification.js";
import { shiftColorSchema } from "@/entities/shift.js";
import { DEFAULT_PAGE_SIZE, pageSizeSchema } from "@/http/pagination.js";

export const SETTING_SCOPES = ["system", "company", "user"] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number];

export interface SettingDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  namespace: string;
  key: string;
  schema: S;
  /** May an individual user override the value? */
  userOverridable: boolean;
  /**
   * May a company override it?
   *
   * Off by default, and deliberately: most settings here describe the
   * installation — where mail goes, how long a session lasts, what a password
   * must contain — and letting one tenant answer those differently is either
   * meaningless or a security hole. Opt a setting in only when each company
   * genuinely should decide it for itself.
   */
  companyOverridable?: boolean;
  description: string;
  /**
   * Suggested keys for a `record` field, by field name.
   *
   * Declared beside the schema rather than worked out by the form, because only
   * the setting knows what belongs in it — a record keyed by a plain string tells
   * the form nothing, and the form guessing would be a second source of truth.
   */
  keyOptions?: Record<string, readonly string[]>;
}

// --- auth ---
export const passwordPolicySchema = z.object({
  minLength: z.number().int().min(8).max(128).default(12),
  requireUppercase: z.boolean().default(true),
  requireNumber: z.boolean().default(true),
  requireSymbol: z.boolean().default(false),
  /** 0 = passwords never expire. */
  expiryDays: z.number().int().min(0).default(0),
  /** How many previous passwords may not be reused. */
  reuseCount: z.number().int().min(0).default(3),
});

export const sessionSettingsSchema = z.object({
  expiresInSeconds: z
    .number()
    .int()
    .min(300)
    .default(60 * 60 * 24 * 7),
  updateAgeSeconds: z
    .number()
    .int()
    .min(0)
    .default(60 * 60 * 24),
});

export const authRateLimitSchema = z.object({
  signInMax: z.number().int().min(1).default(5),
  signInWindowSeconds: z.number().int().min(1).default(60),
});

export const inviteSettingsSchema = z.object({
  expiryHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
});

// --- contact channels ---
/**
 * Where a channel's verification code is actually sent. Email needs nothing — the
 * app already has a mailer. The rest need a provider, and a channel with no
 * provider configured reports itself unavailable rather than pretending to send.
 *
 * Blank means "not configured". Secrets live in the settings store, as SSO client
 * secrets already do.
 */
export const channelProvidersSchema = z.object({
  /** Twilio (or an API-compatible gateway) carries SMS and WhatsApp. */
  twilioAccountSid: z.string().trim().default(""),
  twilioAuthToken: z.string().trim().default(""),
  /** Sender for plain SMS to the mobile, e.g. +15551234567. */
  twilioSmsFrom: z.string().trim().default(""),
  /** Sender for WhatsApp, e.g. whatsapp:+14155238886. */
  twilioWhatsappFrom: z.string().trim().default(""),
  /** Bot token from @BotFather. The user must have started a chat with the bot. */
  telegramBotToken: z.string().trim().default(""),
  /** Bot token from the Discord developer portal. */
  discordBotToken: z.string().trim().default(""),
});

export type ChannelProviders = z.infer<typeof channelProvidersSchema>;

export const channelVerificationSchema = z.object({
  codeLength: z.number().int().min(4).max(10).default(6),
  expiryMinutes: z.number().int().min(1).max(60).default(10),
  /** Wrong guesses allowed before the code is burned. */
  maxAttempts: z.number().int().min(1).max(10).default(5),
  /** How long before another code may be requested for the same channel. */
  resendCooldownSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 10)
    .default(60),
});

export type ChannelVerificationSettings = z.infer<typeof channelVerificationSchema>;

// --- notifications ---
/**
 * The master switch per channel, and how long a read notification is kept.
 *
 * The four messaging channels default **off**. Their providers are unconfigured
 * on a fresh install, and a channel that is enabled without a provider does not
 * degrade — every send fails, in a worker, out of sight of whoever turned it on.
 * Off is the honest default; the admin screen says what each one still needs.
 *
 * `retentionDays` prunes *read* notifications only. An inbox that quietly deletes
 * what you have not read is worse than a long inbox.
 */
export const notificationDeliverySchema = z.object({
  inappEnabled: z.boolean().default(true),
  emailEnabled: z.boolean().default(true),
  mobileEnabled: z.boolean().default(false),
  whatsappEnabled: z.boolean().default(false),
  telegramEnabled: z.boolean().default(false),
  discordEnabled: z.boolean().default(false),
  /** 0 keeps read notifications for ever. */
  retentionDays: z
    .number()
    .int()
    .min(0)
    .max(365 * 5)
    .default(90),
});

export type NotificationDeliverySettings = z.infer<typeof notificationDeliverySchema>;

// --- rotables ("Cartridges") ---
/**
 * The module switch and its one rule, decided per company.
 *
 * Off by default and deliberately: a company that does not refill anything should
 * never see the screens, and an upgrade must not hand every tenant a module they
 * did not ask for.
 *
 * `failureWindowDays` is how soon a part coming back faulty counts as the
 * service's fault. Inside it, the points for that service are reversed by a
 * compensating entry; outside it, the part simply wore out and nobody is docked.
 * Fourteen days is a judgement, which is exactly why it is a setting.
 */
export const partsModuleSchema = z.object({
  enabled: z.boolean().default(false),
  failureWindowDays: z.number().int().min(0).max(365).default(14),
});

export type PartsModuleSettings = z.infer<typeof partsModuleSchema>;

// --- reports / appraisal ---
export const appraisalSettingsSchema = z.object({
  /**
   * How points decay up the reporting line. A report in a manager's downline
   * credits them `rollupFactor ^ depth × the report's points` (depth 1 = a direct
   * report). 0 turns roll-up off; 1 would give every manager the full amount.
   *
   * Changing this is forward-only: points are frozen into a ledger when a report is
   * appraised, so a new factor never rewrites reports already scored.
   */
  rollupFactor: z.number().min(0).max(1).default(0.25),
});

export type AppraisalSettings = z.infer<typeof appraisalSettingsSchema>;

export const reportEntrySettingsSchema = z.object({
  /**
   * The grace period for filing an entry, in days — how far back it may be dated. An
   * **issue** is judged by when it *occurred* (so a real issue reported a few days late
   * is fine, but an ancient one is refused); a **work log** by its report date, which is
   * when its points count. An entry past the grace is refused (a superadmin is exempt).
   * The default (3650) effectively disables the limit — lower it to enforce one.
   */
  graceDays: z.number().int().min(0).max(3650).default(3650),
});

export type ReportEntrySettings = z.infer<typeof reportEntrySettingsSchema>;

export const pointsLockSettingsSchema = z.object({
  /**
   * Close points for a period: an entry whose points-date (a work log's report date, an
   * issue's — like the ledger — report date) is on or before this date is frozen. Its
   * points cannot be re-scored or rejected. Blank means no lock. A status change still
   * re-opens an entry for re-evaluation, and a superadmin can always override.
   * Format YYYY-MM-DD.
   */
  lockedThrough: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Expected YYYY-MM-DD")
    .default(""),
});
export type PointsLockSettings = z.infer<typeof pointsLockSettingsSchema>;

// --- backups ---
export const BACKUP_FREQUENCIES = ["off", "daily", "weekly", "monthly"] as const;
export const backupScheduleSchema = z.object({
  /** How often the scheduled backup runs — `off` disables it (manual only). */
  frequency: z.enum(BACKUP_FREQUENCIES).default("off"),
  /** Delete backups of this kind older than this many days. 0 keeps them all. */
  retentionDays: z.number().int().min(0).max(3650).default(30),
});
export type BackupSchedule = z.infer<typeof backupScheduleSchema>;

// --- storage / attachments ---
export const uploadLimitsSchema = z.object({
  /**
   * The largest single file, in megabytes — this organisation's policy.
   *
   * `STORAGE_MAX_UPLOAD_MB` is a separate, harder ceiling that cuts a request off
   * as it streams, to protect the server's memory. That one is infrastructure and
   * always wins; raising this above it will not accept bigger files. A client-side
   * check is a courtesy to the user and never the limit either.
   */
  maxFileSizeMb: z.number().int().min(1).max(1024).default(25),
  /** How many files one thing may carry. Keeps a report from becoming a folder. */
  maxFilesPerOwner: z.number().int().min(1).max(200).default(20),
  /**
   * The content types accepted, as an allowlist. An allowlist and not a blocklist:
   * a blocklist is a promise to have thought of every dangerous type, and nobody
   * has. Empty means "accept anything", which is a decision an admin can make
   * knowingly — it is not the default.
   */
  allowedTypes: z
    .array(z.string())
    .default([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
});

export type UploadLimits = z.infer<typeof uploadLimitsSchema>;

// --- logging ---
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;
export const logLevelSchema = z.enum(LOG_LEVELS);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const logSinksSchema = z.object({
  console: z.boolean().default(true),
  file: z.boolean().default(false),
  database: z.boolean().default(true),
});

/**
 * The areas that tag their log lines with a `feature`, offered as suggestions
 * when adding an override.
 *
 * Suggestions rather than a closed list: the override map is keyed by a plain
 * string on purpose, so a feature added tomorrow can be turned up today without
 * waiting for a release. But an operator faced with an empty box and the words
 * "Feature name" has to already know the answer, which is a poor way to learn it.
 *
 * Keep this in step with the `feature:` values the API actually logs.
 */
export const LOG_FEATURES = [
  "api",
  "auth",
  "backups",
  "client",
  "debug",
  "email",
  "maintenance",
  "notifications",
  "reminders",
  "routine-award",
] as const;

export const logLevelsSchema = z.object({
  default: logLevelSchema.default("info"),
  /** Per-feature overrides, e.g. `{ "auth": "debug" }`. */
  features: z.record(z.string(), logLevelSchema).default({}),
});

export const logRetentionSchema = z.object({
  databaseDays: z.number().int().min(1).max(3650).default(30),
  fileDays: z.number().int().min(1).max(3650).default(14),
});

export const logBufferSchema = z.object({
  /** Buffer log lines in Redis and flush them to the log DB asynchronously. */
  enabled: z.boolean().default(false),
  batchSize: z.number().int().min(1).max(1000).default(200),
});

export const LOG_BUFFER: SettingDef<typeof logBufferSchema> = {
  namespace: "logging",
  key: "buffer",
  schema: logBufferSchema,
  userOverridable: false,
  description: "Buffer logs through Redis instead of writing to the log database inline",
};

export const LOG_SINKS: SettingDef<typeof logSinksSchema> = {
  namespace: "logging",
  key: "sinks",
  schema: logSinksSchema,
  userOverridable: false,
  description: "Which log sinks are enabled (console, rotating file, log database)",
};

export const LOG_LEVEL_SETTINGS: SettingDef<typeof logLevelsSchema> = {
  namespace: "logging",
  key: "levels",
  schema: logLevelsSchema,
  userOverridable: false,
  description: "Default log level and per-feature overrides",
  keyOptions: { features: LOG_FEATURES },
};

export const LOG_RETENTION: SettingDef<typeof logRetentionSchema> = {
  namespace: "logging",
  key: "retention",
  schema: logRetentionSchema,
  userOverridable: false,
  description: "How long logs are kept, per sink",
};

// --- ui ---
/** The eight seeded palettes; each is a CSS variable set selected by `data-theme`. */
export const THEME_PALETTES = [
  "aurora",
  "ocean",
  "forest",
  "sunset",
  "ember",
  "orchid",
  "citrus",
  "graphite",
] as const;
export type ThemePalette = (typeof THEME_PALETTES)[number];

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const themeSettingsSchema = z.object({
  palette: z.enum(THEME_PALETTES).default("aurora"),
  mode: z.enum(THEME_MODES).default("system"),
});

export type ThemeSettings = z.infer<typeof themeSettingsSchema>;

export const UI_THEME: SettingDef<typeof themeSettingsSchema> = {
  namespace: "ui",
  key: "theme",
  schema: themeSettingsSchema,
  userOverridable: true,
  description: "Colour palette and light/dark mode (admins set the org default)",
};

/** Row height. Purely presentational: the API never sees it. */
export const TABLE_DENSITIES = ["comfortable", "compact"] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

export const tableDefaultsSchema = z.object({
  /** Rows per page used when a request omits `pageSize`. */
  pageSize: pageSizeSchema.default(DEFAULT_PAGE_SIZE),
  density: z.enum(TABLE_DENSITIES).default("comfortable"),
});

export type TableDefaults = z.infer<typeof tableDefaultsSchema>;

export const TABLE_DEFAULTS: SettingDef<typeof tableDefaultsSchema> = {
  namespace: "ui",
  key: "tableDefaults",
  schema: tableDefaultsSchema,
  userOverridable: true,
  description:
    "Default rows per page and row density for tables (admins set the default; users may override)",
};

/**
 * Save confirmations.
 *
 * Saving an edit used to return you to the index, which was its own confirmation —
 * crude, but you knew it had worked. Now an edit stays where it is, so something
 * has to say so, and on a long form an inline message can be off-screen.
 *
 * Configurable because a notification that appears without being asked for is a
 * matter of taste: some people find them reassuring and some find them noise, and
 * the corner they appear in collides with different things on different screens.
 */
export const TOAST_POSITIONS = ["top-right", "bottom-right", "bottom-center"] as const;
export type ToastPosition = (typeof TOAST_POSITIONS)[number];

/** Seconds before a toast fades. 0 means it waits to be dismissed. */
export const TOAST_DURATIONS = [2, 4, 8, 0] as const;

export const toastSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  position: z.enum(TOAST_POSITIONS).default("bottom-right"),
  seconds: z.number().int().min(0).max(60).default(4),
});

export type ToastSettings = z.infer<typeof toastSettingsSchema>;

export const UI_TOASTS: SettingDef<typeof toastSettingsSchema> = {
  namespace: "ui",
  key: "toasts",
  schema: toastSettingsSchema,
  userOverridable: true,
  description:
    "Whether a save shows a brief confirmation, where it appears, and how long it stays " +
    "(admins set the default; users may override)",
};

// --- debug ---
export const debugModeSchema = z.object({
  enabled: z.boolean().default(false),
  /** Auto-expiry; null means "until switched off" (only used for the default). */
  expiresAt: z.string().datetime().nullable().default(null),
});

export type DebugMode = z.infer<typeof debugModeSchema>;

/** Debug is active only while enabled AND not past its expiry. */
export function isDebugActive(mode: DebugMode, now: Date = new Date()): boolean {
  if (!mode.enabled) return false;
  if (!mode.expiresAt) return true;
  return new Date(mode.expiresAt) > now;
}

export const DEBUG_MODE: SettingDef<typeof debugModeSchema> = {
  namespace: "debug",
  key: "mode",
  schema: debugModeSchema,
  userOverridable: true,
  description: "Verbose request debugging; auto-expires",
};

/**
 * Whether the shipped roles are in force.
 *
 * An installation that describes its own access from scratch does not want fifty
 * system roles cluttering every picker — but deleting them is not the answer, since
 * they cannot be deleted and, more to the point, the decision has to be reversible.
 *
 * Off means: the shipped roles are not offered, are shown as disabled where a group
 * already holds one, and **stop conferring permissions**. Nothing is deleted — the
 * group↔role rows stay exactly as they are, so turning it back on restores every
 * grant. That is what makes the switch safe to try.
 *
 * The Superadmin *group* bypasses roles entirely, so whoever turns it off can always
 * turn it back on.
 */
export const systemRolesSchema = z.object({
  enabled: z.boolean().default(true),
});

export const SYSTEM_ROLES_SETTING: SettingDef<typeof systemRolesSchema> = {
  namespace: "access",
  key: "systemRoles",
  schema: systemRolesSchema,
  userOverridable: false,
  description:
    "Whether the shipped system roles grant anything. Turning them off hides them from " +
    "the pickers and stops them conferring permissions; no assignment is deleted, so " +
    "turning them back on restores every grant.",
};

/**
 * Whether two-factor is compulsory, and how long people get to enrol.
 *
 * A **floor, never a ceiling**: a group may require it where the installation does
 * not, and a company may require it where neither does, but nothing waives a
 * requirement somebody else imposed. Precedence rules that let one level cancel
 * another end in an argument about which level won.
 *
 * `graceDays` is the part that stops this being cruel. Turning the requirement on
 * with no grace locks out everybody who has not enrolled, mid-shift, at once. The
 * countdown runs from when the requirement first applied **to that person**, not
 * from when the switch was flipped — otherwise somebody added to a required group
 * months later is locked out on their first day.
 */
export const twoFactorSettingsSchema = z.object({
  /** `required` makes it compulsory for everybody in the installation. */
  mode: z.enum(["optional", "required"]).default("optional"),
  /**
   * Superadmins hold every permission on the server, so "compulsory for everyone
   * except the account that can do anything" is the wrong default. Its own flag
   * rather than an implication, so the choice is visible.
   */
  requireForSuperadmins: z.boolean().default(false),
  /** Days to enrol before the requirement bites. 0 = immediately. */
  graceDays: z.number().int().min(0).max(90).default(7),
});

export const TWO_FACTOR_SETTINGS: SettingDef<typeof twoFactorSettingsSchema> = {
  namespace: "auth",
  key: "twoFactor",
  schema: twoFactorSettingsSchema,
  userOverridable: false,
  // A company may raise the bar for its own people; the service refuses an attempt
  // to lower one the installation has set.
  companyOverridable: true,
  description:
    "Whether two-factor authentication is compulsory, for superadmins as well, and how many days people have to enrol before it is enforced",
};

/**
 * What colour a day off, a leave day and a public holiday are on the calendar.
 *
 * Hardcoded until now, which meant the three codes people scan for hardest were the
 * three nobody could change. They take the same palette as the shifts, so a month is
 * one visual language rather than "shifts have colours and states have opinions".
 *
 * Company-overridable: which colour means leave is a local convention, and two
 * companies on one server may reasonably disagree.
 */
export const scheduleStateColorsSchema = z.object({
  /** A day off should read as "nothing happening", not as an event. */
  off: shiftColorSchema.default("slate"),
  /** Dark red by default: leave is what a manager scans a month for. */
  leave: shiftColorSchema.default("dark-red"),
  holiday: shiftColorSchema.default("teal"),
});

export type ScheduleStateColors = z.infer<typeof scheduleStateColorsSchema>;

export const SCHEDULE_STATE_COLORS: SettingDef<typeof scheduleStateColorsSchema> = {
  namespace: "shifts",
  key: "stateColors",
  schema: scheduleStateColorsSchema,
  userOverridable: false,
  companyOverridable: true,
  description: "The calendar colours for a day off (W/O), leave (L) and a public holiday (PH)",
};

export const PASSWORD_POLICY: SettingDef<typeof passwordPolicySchema> = {
  namespace: "auth",
  key: "passwordPolicy",
  schema: passwordPolicySchema,
  userOverridable: false,
  description: "Password length, complexity, expiry, and reuse rules",
};

export const SESSION_SETTINGS: SettingDef<typeof sessionSettingsSchema> = {
  namespace: "auth",
  key: "session",
  schema: sessionSettingsSchema,
  userOverridable: false,
  description: "Session lifetime and refresh interval",
};

export const AUTH_RATE_LIMIT: SettingDef<typeof authRateLimitSchema> = {
  namespace: "auth",
  key: "rateLimit",
  schema: authRateLimitSchema,
  userOverridable: false,
  description: "Rate limits applied to credential endpoints",
};

export const INVITE_SETTINGS: SettingDef<typeof inviteSettingsSchema> = {
  namespace: "auth",
  key: "invite",
  schema: inviteSettingsSchema,
  userOverridable: false,
  description: "How long a user invitation stays valid",
};

export const CHANNEL_PROVIDERS: SettingDef<typeof channelProvidersSchema> = {
  namespace: "channels",
  key: "providers",
  schema: channelProvidersSchema,
  userOverridable: false,
  description: "Providers that deliver verification codes to SMS, WhatsApp, Telegram and Discord",
};

export const CHANNEL_VERIFICATION: SettingDef<typeof channelVerificationSchema> = {
  namespace: "channels",
  key: "verification",
  schema: channelVerificationSchema,
  userOverridable: false,
  description: "Verification code length, lifetime, attempt limit and resend cooldown",
};

export const NOTIFICATION_DELIVERY: SettingDef<typeof notificationDeliverySchema> = {
  namespace: "notifications",
  key: "delivery",
  schema: notificationDeliverySchema,
  userOverridable: false,
  description: "Which channels notifications may use at all, and how long read ones are kept",
};

/**
 * Which channels each notification type is allowed to use — the outer bound on
 * every user's own preference.
 *
 * Declared here so writes go through the same validation and cache invalidation
 * as every other setting, but the generated form cannot render it: a record of
 * twenty-odd types against six channels is a matrix, and a matrix drawn as a
 * key/value list is unusable. The Settings page gives this namespace its own
 * renderer, as `debug` already does.
 */
export const NOTIFICATION_MATRIX: SettingDef<typeof notificationMatrixSchema> = {
  namespace: "notifications",
  key: "matrix",
  schema: notificationMatrixSchema,
  userOverridable: false,
  description: "Per notification type, the channels users are permitted to receive it on",
};

export const PARTS_MODULE: SettingDef<typeof partsModuleSchema> = {
  namespace: "parts",
  key: "module",
  schema: partsModuleSchema,
  userOverridable: false,
  // The first setting to use the company scope, and the reason it exists: whether
  // a tenant refills cartridges is the tenant's business, not the installation's.
  companyOverridable: true,
  description:
    "Cartridge tracking: whether this company uses it, and how soon a failed part reverses its points",
};

export const APPRAISAL_SETTINGS: SettingDef<typeof appraisalSettingsSchema> = {
  namespace: "reports",
  key: "appraisal",
  schema: appraisalSettingsSchema,
  userOverridable: false,
  description: "How report points roll up the reporting line",
};

export const REPORT_ENTRY_SETTINGS: SettingDef<typeof reportEntrySettingsSchema> = {
  namespace: "reports",
  key: "entry",
  schema: reportEntrySettingsSchema,
  userOverridable: false,
  description: "The grace period for filing a report — how many days late an entry may be dated",
};

export const POINTS_LOCK_SETTINGS: SettingDef<typeof pointsLockSettingsSchema> = {
  namespace: "reports",
  key: "lock",
  schema: pointsLockSettingsSchema,
  userOverridable: false,
  description:
    "Close points for a period — entries up to this date can no longer be re-scored (YYYY-MM-DD; blank = off)",
};

export const DATABASE_BACKUP_SETTINGS: SettingDef<typeof backupScheduleSchema> = {
  namespace: "backups",
  key: "database",
  schema: backupScheduleSchema,
  userOverridable: false,
  description: "How often the database is backed up automatically, and how long to keep the dumps",
};

export const FILES_BACKUP_SETTINGS: SettingDef<typeof backupScheduleSchema> = {
  namespace: "backups",
  key: "files",
  schema: backupScheduleSchema,
  userOverridable: false,
  description:
    "How often uploaded files are backed up automatically, and how long to keep the archives",
};

export const UPLOAD_LIMITS: SettingDef<typeof uploadLimitsSchema> = {
  namespace: "storage",
  key: "uploads",
  schema: uploadLimitsSchema,
  userOverridable: false,
  description: "Attachment size cap, how many files one record may carry, and the accepted types",
};

export const ALL_SETTING_DEFS: readonly SettingDef[] = [
  PASSWORD_POLICY,
  SESSION_SETTINGS,
  AUTH_RATE_LIMIT,
  INVITE_SETTINGS,
  CHANNEL_PROVIDERS,
  CHANNEL_VERIFICATION,
  NOTIFICATION_DELIVERY,
  NOTIFICATION_MATRIX,
  PARTS_MODULE,
  APPRAISAL_SETTINGS,
  REPORT_ENTRY_SETTINGS,
  POINTS_LOCK_SETTINGS,
  DATABASE_BACKUP_SETTINGS,
  FILES_BACKUP_SETTINGS,
  UPLOAD_LIMITS,
  LOG_SINKS,
  LOG_LEVEL_SETTINGS,
  LOG_RETENTION,
  LOG_BUFFER,
  DEBUG_MODE,
  TABLE_DEFAULTS,
  UI_THEME,
  UI_TOASTS,
  SYSTEM_ROLES_SETTING,
  TWO_FACTOR_SETTINGS,
  SCHEDULE_STATE_COLORS,
];

export function findSettingDef(namespace: string, key: string): SettingDef | undefined {
  return ALL_SETTING_DEFS.find((d) => d.namespace === namespace && d.key === key);
}

/** The declared default for a setting (every field in every schema has one). */
export function defaultFor<S extends z.ZodTypeAny>(def: SettingDef<S>): z.infer<S> {
  return def.schema.parse({}) as z.infer<S>;
}
