// Author: Brijesh Dave <https://github.com/brijeshdave>
// Settings service. Preferences a user may override (theme, table defaults) are
// read from `/settings/me`, which needs only a session — a brand-new user with no
// groups can still load their theme.
import {
  TABLE_DEFAULTS,
  UI_THEME,
  type PasswordRules,
  type TableDefaults,
  type ThemeSettings,
  passwordRulesSchema,
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
}

function pick(records: SettingRecord[], namespace: string, key: string): unknown {
  return records.find((r) => r.namespace === namespace && r.key === key)?.value;
}

export interface MyPreferences {
  theme: ThemeSettings;
  tableDefaults: TableDefaults;
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
