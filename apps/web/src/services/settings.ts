// Author: Brijesh Dave <https://github.com/brijeshdave>
// Settings service. Preferences a user may override (theme, table defaults) are
// read from `/settings/me`, which needs only a session — a brand-new user with no
// groups can still load their theme.
import {
  TABLE_DEFAULTS,
  UI_THEME,
  type PasswordRules,
  type TableColumns,
  type TableDefaults,
  type ThemeSettings,
  passwordRulesSchema,
  TABLE_COLUMNS,
  TABLE_VIEWS,
  tableColumnsSchema,
  tableViewsSchema,
  type TableViews,
  tableDefaultsSchema,
  themeSettingsSchema,
  UI_TOASTS,
  toastSettingsSchema,
  type ToastSettings,
} from "@reportly/shared";

import { http } from "@/services/http.js";

export interface SettingRecord {
  namespace: string;
  key: string;
  userOverridable: boolean;
  description: string;
  value: unknown;
  /** What everyone without an answer of their own gets. Only `/settings/me` sends it. */
  orgValue?: unknown;
}

function pick(records: SettingRecord[], namespace: string, key: string): unknown {
  return records.find((r) => r.namespace === namespace && r.key === key)?.value;
}

function pickOrg(records: SettingRecord[], namespace: string, key: string): unknown {
  return records.find((r) => r.namespace === namespace && r.key === key)?.orgValue;
}

export interface MyPreferences {
  theme: ThemeSettings;
  tableDefaults: TableDefaults;
  /** Per table, the columns this person has hidden. Absent means show everything. */
  tableColumns: TableColumns;
  /** How this person has arranged each table: columns, sorting, filters. */
  tableViews: TableViews;
  /**
   * The same, as an administrator set it for everyone.
   *
   * Kept beside the person's own rather than resolved into it, because the
   * inheritance is per table: somebody who arranged the journal has said nothing
   * about the tasks table, and that table must still follow the organisation's
   * default. The merge happens a table at a time, in `useListResource`.
   */
  orgTableViews: TableViews;
  toasts: ToastSettings;
}

/** The caller's effective preferences (their override, else the org default). */
export async function fetchMyPreferences(): Promise<MyPreferences> {
  const records = await http.get<SettingRecord[]>("/settings/me");
  return {
    theme: themeSettingsSchema.parse(pick(records, UI_THEME.namespace, UI_THEME.key) ?? {}),
    tableDefaults: tableDefaultsSchema.parse(
      pick(records, TABLE_DEFAULTS.namespace, TABLE_DEFAULTS.key) ?? {},
    ),
    tableColumns: tableColumnsSchema.parse(
      pick(records, TABLE_COLUMNS.namespace, TABLE_COLUMNS.key) ?? {},
    ),
    tableViews: tableViewsSchema.parse(pick(records, TABLE_VIEWS.namespace, TABLE_VIEWS.key) ?? {}),
    orgTableViews: tableViewsSchema.parse(
      pickOrg(records, TABLE_VIEWS.namespace, TABLE_VIEWS.key) ?? {},
    ),
    toasts: toastSettingsSchema.parse(pick(records, UI_TOASTS.namespace, UI_TOASTS.key) ?? {}),
  };
}

/**
 * The rules a new password must satisfy. Public: the sign-up, reset and
 * accept-invite forms need them before the user has a session.
 */
export async function fetchPasswordRules(): Promise<PasswordRules> {
  return passwordRulesSchema.parse(await http.get<unknown>("/password-rules"));
}

/** Persist the caller's own save-confirmation preferences. */
export async function saveMyToasts(toasts: ToastSettings): Promise<ToastSettings> {
  const record = await http.put<SettingRecord>(
    `/settings/me/${UI_TOASTS.namespace}/${UI_TOASTS.key}`,
    { value: toasts },
  );
  return toastSettingsSchema.parse(record.value);
}

/** Persist the caller's own theme (does not change the org default). */
export async function saveMyTheme(theme: ThemeSettings): Promise<ThemeSettings> {
  const record = await http.put<SettingRecord>(
    `/settings/me/${UI_THEME.namespace}/${UI_THEME.key}`,
    { value: theme },
  );
  return themeSettingsSchema.parse(record.value);
}

/**
 * Persist the caller's own table preferences. The whole object is sent because a
 * setting is stored whole: posting `{ pageSize }` alone would reset `density` to
 * its default.
 */
export async function saveMyTableDefaults(defaults: TableDefaults): Promise<TableDefaults> {
  const record = await http.put<SettingRecord>(
    `/settings/me/${TABLE_DEFAULTS.namespace}/${TABLE_DEFAULTS.key}`,
    { value: defaults },
  );
  return tableDefaultsSchema.parse(record.value);
}

/**
 * Persist which columns this person hides, for every table at once.
 *
 * The whole record is sent because a setting is stored whole — writing one table's
 * entry alone would drop the others. Callers pass the map they already hold.
 */
export async function saveMyTableColumns(columns: TableColumns): Promise<TableColumns> {
  const record = await http.put<SettingRecord>(
    `/settings/me/${TABLE_COLUMNS.namespace}/${TABLE_COLUMNS.key}`,
    { value: columns },
  );
  return tableColumnsSchema.parse(record.value);
}

/**
 * Persist how this person has arranged their tables — columns, sorting and filters.
 *
 * The whole record is sent, as every setting write here does: a setting is stored
 * whole, so posting one table's entry alone would drop every other table's.
 */
export async function saveMyTableViews(views: TableViews): Promise<TableViews> {
  const record = await http.put<SettingRecord>(
    `/settings/me/${TABLE_VIEWS.namespace}/${TABLE_VIEWS.key}`,
    { value: views },
  );
  return tableViewsSchema.parse(record.value);
}

/**
 * Set how a table opens for everyone who has not arranged it themselves.
 *
 * The installation-wide write, so it needs `settings:manage` — the permission that
 * already governs every other installation setting, rather than a new one invented
 * for tables.
 */
export async function saveOrgTableViews(views: TableViews): Promise<TableViews> {
  const record = await http.put<SettingRecord>(
    `/settings/${TABLE_VIEWS.namespace}/${TABLE_VIEWS.key}`,
    { value: views },
  );
  return tableViewsSchema.parse(record.value);
}

/** Every setting with its effective value (admin view). Needs settings:read. */
export function fetchAllSettings(): Promise<SettingRecord[]> {
  return http.get<SettingRecord[]>("/settings");
}

/**
 * One company's answers for the settings a company may answer — today, which
 * optional modules it uses. Needs `companies:read`.
 */
export function fetchCompanySettings(companyId: string): Promise<SettingRecord[]> {
  return http.get<SettingRecord[]>(`/companies/${companyId}/settings`);
}

/** Write one company's answer. Needs `companies:update`, not `settings:manage`. */
export async function saveCompanySetting(
  companyId: string,
  namespace: string,
  key: string,
  value: unknown,
): Promise<SettingRecord> {
  return http.put<SettingRecord>(`/companies/${companyId}/settings/${namespace}/${key}`, { value });
}

/** Write a system-wide setting. Needs settings:manage. */
export async function saveSystemSetting(
  namespace: string,
  key: string,
  value: unknown,
): Promise<SettingRecord> {
  return http.put<SettingRecord>(`/settings/${namespace}/${key}`, { value });
}
