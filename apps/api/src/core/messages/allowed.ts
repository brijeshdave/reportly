// Author: Brijesh Dave <https://github.com/brijeshdave>
// May Reportly send this kind of message at all?
//
// Asked in the same two places that record a message — the email queue and the
// channel senders — so a switch cannot be dodged by a caller that took another
// route. One funnel decides both "write it down" and "send it".
//
// Fails **open**: unreadable settings must not silently stop a password reset
// going out. A message sent against an administrator's wishes is a nuisance; an
// installation that quietly stops mailing is the fault this whole plan is about.
import { TRANSACTIONAL_MESSAGES, type MessageKind } from "@reportly/shared";

import { logger } from "@/core/logger.js";
import { getSystemSetting } from "@/core/settings/service.js";

/** Which switch governs which kind. `test` has none — it is the switch's own proof. */
const SWITCH: Record<MessageKind, keyof Awaited<ReturnType<typeof settings>> | null> = {
  "password-reset": "passwordReset",
  invite: "invite",
  "two-factor-reset": "twoFactorReset",
  "verification-code": "verificationCode",
  notification: "notification",
  test: null,
};

const settings = () => getSystemSetting(TRANSACTIONAL_MESSAGES);

export async function maySend(kind: MessageKind): Promise<boolean> {
  const key = SWITCH[kind];
  if (!key) return true;
  try {
    return (await settings())[key];
  } catch (error) {
    logger.warn({ err: error, kind }, "Could not read the message switches; sending anyway");
    return true;
  }
}
