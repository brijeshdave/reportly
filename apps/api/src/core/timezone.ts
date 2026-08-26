// Author: Brijesh Dave <https://github.com/brijeshdave>
// The working day the server counts by.
//
// Anything a person sees in a browser already follows their own clock: the day
// windows are computed there and sent with the request. The server has plenty of
// days of its own to decide with nobody's browser present — which day a routine
// occurrence belongs to, which day points were earned on, when a month closes —
// and it was reading the container's clock, which is UTC.
//
// At +05:30 that meant every night between midnight and 05:30 was filed under
// yesterday: a routine logged at 1am counted against the day before, and expired
// five and a half hours early.
import { TIMEZONE, todayIn } from "@reportly/shared";

import { getCompanySetting, getSystemSetting } from "@/core/settings/service.js";

/**
 * The timezone to count days in — the company's own, else the installation's.
 *
 * A group with sites in two countries has two working days, and the routine that
 * rolls over at midnight should roll over at each site's midnight. Resolved in one
 * place so no caller has to remember the fallback.
 */
export async function timezoneFor(companyId: string | null): Promise<string> {
  if (companyId) {
    const company = await getCompanySetting(TIMEZONE, companyId);
    if (company) return company.name;
  }
  return (await getSystemSetting(TIMEZONE)).name;
}

/** Today's `YYYY-MM-DD`, where that company works. */
export async function todayFor(companyId: string | null): Promise<string> {
  return todayIn(await timezoneFor(companyId));
}
