// Author: Brijesh Dave <https://github.com/brijeshdave>
// Send one message, now, and say exactly what happened.
//
// The fault this answers: `cli doctor` reported "smtp.resend.com:465 accepted the
// connection" while Resend was refusing **every message** with "API key not
// authorized for this domain". A TCP handshake proves the relay is reachable and
// nothing else. Only a real send exercises the API key, the MAIL_FROM domain and
// the recipient rules together — which is where this installation actually broke,
// for a week, believing it was fine.
//
// Deliberately **not** queued. A queued send answers "accepted for delivery",
// which is the useless half of the answer; the point of a test is to hold the
// provider's own words up to the person who pressed the button.
import { type Channel, type ChannelProviders, CHANNEL_PROVIDERS } from "@reportly/shared";

import { logger } from "@/core/logger.js";
import { sendEmail } from "@/core/mail/mailer.js";
import { testEmail } from "@/core/mail/templates.js";
import { markFailed, markSent, recordQueued } from "@/core/messages/record.js";
import { sendToChannel } from "@/core/channels/senders.js";
import { getSystemSetting } from "@/core/settings/service.js";

export interface TestResult {
  delivered: boolean;
  /** The provider's own words when it refused. Never tidied. */
  error: string | null;
}

/**
 * Send a test to one destination over one channel.
 *
 * Recorded in the outbound log like any other message, so the failure is on the
 * Messages screen too rather than only in whatever tab was open at the time.
 *
 * The per-kind switches do not gate this: `test` is the switch's own proof, and
 * an administrator checking whether email works has plainly asked for this one.
 */
export async function sendTest(channel: Channel, destination: string): Promise<TestResult> {
  const messageId = await recordQueued({
    channel,
    kind: "test",
    destination,
    subject: "Reportly test message",
  });

  try {
    if (channel === "email") {
      // Straight to the mailer, not the queue — see the note at the top.
      await sendEmail({ to: destination, ...testEmail() });
    } else {
      const providers: ChannelProviders = await getSystemSetting(CHANNEL_PROVIDERS);
      await sendToChannel(
        providers,
        channel,
        destination,
        "Reportly test message",
        "If you are reading this, the channel is configured correctly.",
      );
    }
  } catch (error) {
    await markFailed(messageId, error);
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: error, channel }, "Test message refused");
    return { delivered: false, error: message };
  }

  await markSent(messageId);
  return { delivered: true, error: null };
}
