// Author: Brijesh Dave <https://github.com/brijeshdave>
// Whether this company uses the module at all, and the one rule it configures.
//
// Two different questions, deliberately kept apart: the SETTING says whether this
// company does this work, the PERMISSION says who does it. A technician with
// every parts grant sees nothing at a company that does not refill cartridges,
// and an administrator at a company that does cannot service a part without the
// grant. Neither answer substitutes for the other.
import { ERROR_CODES, PARTS_MODULE, type PartsModuleSettings } from "@reportly/shared";

import { AppError } from "@/core/errors.js";
import { getEffectiveSetting } from "@/core/settings/service.js";

/** The module's settings as they apply to one company. */
export async function moduleSettings(companyId: string): Promise<PartsModuleSettings> {
  return getEffectiveSetting(PARTS_MODULE, { companyId });
}

/**
 * Refuse everything unless the company has switched the module on.
 *
 * A 404, not a 403. "You may not" tells somebody the feature exists and they are
 * missing a grant, which is a lie here and sends them to their administrator
 * asking for the wrong thing. For a company that does not use this, the module
 * genuinely is not there.
 */
export async function requireModule(companyId: string | null): Promise<string> {
  if (!companyId) {
    throw new AppError(400, ERROR_CODES.VALIDATION_ERROR, "Pick a company first (X-Company-Id)");
  }
  const settings = await moduleSettings(companyId);
  if (!settings.enabled) {
    throw new AppError(404, ERROR_CODES.NOT_FOUND, "Not found");
  }
  return companyId;
}
