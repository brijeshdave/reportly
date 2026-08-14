// Author: Brijesh Dave <https://github.com/brijeshdave>
// The three gates, tested one at a time and then against each other.
//
// This is the part of notifications that is easy to get subtly wrong and hard to
// notice: every failure mode here is silent. A gate that is too tight produces
// nothing, and "I never got it" is indistinguishable from "nothing happened". A
// gate that is too loose sends a person something they switched off, which they
// report as a bug in the switch.
import {
  NOTIFICATION_TYPES,
  type NotificationDeliverySettings,
  notificationDeliverySchema,
} from "@reportly/shared";
import { describe, expect, it } from "vitest";

import type { ContactRow } from "@/features/notifications/audience-repo.js";
import {
  channelsFor,
  deliverableChannels,
  toOverrideMap,
  type RecipientState,
} from "@/features/notifications/resolver.js";

/** A type that goes to the inbox and email by default. */
const EMAIL_TYPE = NOTIFICATION_TYPES.find((t) => t.defaultChannels.includes("email"))!.type;

/** A type that defaults to the inbox only. */
const INAPP_ONLY_TYPE = NOTIFICATION_TYPES.find((t) => !t.defaultChannels.includes("email"))!.type;

const ALL_ON: NotificationDeliverySettings = notificationDeliverySchema.parse({
  mobileEnabled: true,
  whatsappEnabled: true,
  telegramEnabled: true,
  discordEnabled: true,
});

function recipient(over: Partial<RecipientState> = {}): RecipientState {
  return {
    userId: "u1",
    deliverable: new Set(["inapp", "email"]),
    overrides: new Map(),
    ...over,
  };
}

describe("gate 1 — what the administrator permits", () => {
  it("sends the declared defaults when nothing is configured", () => {
    expect(channelsFor(EMAIL_TYPE, recipient(), {}, ALL_ON)).toEqual(["inapp", "email"]);
  });

  it("drops a channel switched off system-wide", () => {
    const noEmail = notificationDeliverySchema.parse({ emailEnabled: false });
    expect(channelsFor(EMAIL_TYPE, recipient(), {}, noEmail)).toEqual(["inapp"]);
  });

  it("lets the matrix narrow a type to nothing", () => {
    expect(channelsFor(EMAIL_TYPE, recipient(), { [EMAIL_TYPE]: [] }, ALL_ON)).toEqual([]);
  });

  it("lets the matrix widen a type beyond its catalogue defaults", () => {
    // This is how "set the default for all users" reaches people who never open
    // the preference screen — the whole point of the matrix. The catalogue's
    // defaults only seed the row; once an administrator edits it, their row is
    // the default.
    const state = recipient({ deliverable: new Set(["inapp", "email"]) });
    expect(
      channelsFor(INAPP_ONLY_TYPE, state, { [INAPP_ONLY_TYPE]: ["inapp", "email"] }, ALL_ON),
    ).toEqual(["inapp", "email"]);
  });

  it("gives an unknown type no channels at all", () => {
    // Not "all of them". A type absent from the catalogue appears on no screen, so
    // a delivery nobody can switch off is the worst possible fallback.
    expect(channelsFor("journal.invented", recipient(), {}, ALL_ON)).toEqual([]);
  });
});

describe("gate 2 — what the person chose", () => {
  it("honours an opt-out", () => {
    const state = recipient({
      overrides: toOverrideMap([{ type: EMAIL_TYPE, channel: "email", enabled: false }]),
    });
    expect(channelsFor(EMAIL_TYPE, state, {}, ALL_ON)).toEqual(["inapp"]);
  });

  it("cannot opt in to a channel the administrator did not choose", () => {
    // The matrix row is the bound as well as the default. A stored `true` for a
    // channel outside it is inert — which is the behaviour that matters when an
    // operator switches a channel off after people have already opted in.
    const state = recipient({
      overrides: toOverrideMap([{ type: INAPP_ONLY_TYPE, channel: "email", enabled: true }]),
    });
    expect(channelsFor(INAPP_ONLY_TYPE, state, {}, ALL_ON)).toEqual(["inapp"]);
  });

  it("re-enables a channel the person had muted", () => {
    const state = recipient({
      overrides: toOverrideMap([{ type: EMAIL_TYPE, channel: "email", enabled: true }]),
    });
    expect(channelsFor(EMAIL_TYPE, state, {}, ALL_ON)).toEqual(["inapp", "email"]);
  });
});

describe("gate 3 — what can reach them", () => {
  const base: ContactRow = {
    userId: "u1",
    name: "Ada",
    email: "ada@example.com",
    mobile: null,
    whatsappOnMobile: false,
    telegramOnMobile: false,
    discordHandle: null,
    mobileVerifiedAt: null,
    whatsappVerifiedAt: null,
    telegramVerifiedAt: null,
    discordVerifiedAt: null,
  };
  const allProviders = { mobile: true, whatsapp: true, telegram: true, discord: true };

  it("always reaches the inbox and the address the account was made with", () => {
    // Email needs no verification timestamp: an account is created against an
    // address and invited over it, so demanding proof would silence every user an
    // administrator ever added.
    expect([...deliverableChannels(base, allProviders)]).toEqual(["inapp", "email"]);
  });

  it("needs a verified destination for the opt-in channels", () => {
    const unverified = { ...base, mobile: "+15551234567" };
    expect(deliverableChannels(unverified, allProviders).has("mobile")).toBe(false);

    const verified = { ...unverified, mobileVerifiedAt: new Date() };
    expect(deliverableChannels(verified, allProviders).has("mobile")).toBe(true);
  });

  it("needs the flag as well as the number for WhatsApp", () => {
    const numberOnly = { ...base, mobile: "+15551234567", mobileVerifiedAt: new Date() };
    expect(deliverableChannels(numberOnly, allProviders).has("whatsapp")).toBe(false);

    const flagged = { ...numberOnly, whatsappOnMobile: true, whatsappVerifiedAt: new Date() };
    expect(deliverableChannels(flagged, allProviders).has("whatsapp")).toBe(true);
  });

  it("drops a verified channel whose provider is not configured", () => {
    // A verified number is no use with no gateway behind it, and pretending
    // otherwise produces a send that fails in a worker where nobody is looking.
    const verified = {
      ...base,
      mobile: "+15551234567",
      mobileVerifiedAt: new Date(),
      whatsappOnMobile: true,
      whatsappVerifiedAt: new Date(),
    };
    const noTwilio = { mobile: false, whatsapp: false, telegram: true, discord: true };
    const reachable = deliverableChannels(verified, noTwilio);
    expect(reachable.has("mobile")).toBe(false);
    expect(reachable.has("whatsapp")).toBe(false);
    expect(reachable.has("inapp")).toBe(true);
  });

  it("removes a channel from the result even when everything else says yes", () => {
    const state = recipient({ deliverable: new Set(["inapp"]) });
    expect(channelsFor(EMAIL_TYPE, state, {}, ALL_ON)).toEqual(["inapp"]);
  });
});

describe("the gates together", () => {
  it("writes the inbox before anything leaves the building", () => {
    // Ordering matters: if a provider throws, the record of what happened already
    // exists. In-app must come first in every result.
    const state = recipient({ deliverable: new Set(["inapp", "email"]) });
    expect(channelsFor(EMAIL_TYPE, state, {}, ALL_ON)[0]).toBe("inapp");
  });

  it("system-off beats user-on beats nothing configured", () => {
    const state = recipient({
      overrides: toOverrideMap([{ type: EMAIL_TYPE, channel: "email", enabled: true }]),
    });
    const noEmail = notificationDeliverySchema.parse({ emailEnabled: false });
    expect(channelsFor(EMAIL_TYPE, state, {}, noEmail)).toEqual(["inapp"]);
  });
});
