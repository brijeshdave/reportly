// Author: Brijesh Dave <https://github.com/brijeshdave>
// Integrity of the notification catalogue.
//
// The catalogue is read by three separate things — the emitters, the admin
// matrix, the preference screen — so an entry that is subtly malformed does not
// fail loudly anywhere. It produces a row with no label, or a default channel the
// administrator was never offered, and nobody notices until somebody asks why
// they are not getting an email. These tests are the loud failure.
import { describe, expect, it } from "vitest";

import {
  ALL_NOTIFICATION_TYPES,
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  allowedChannelsFor,
  asContactChannel,
  findNotificationType,
  isContactChannel,
} from "@/entities/notification.js";

describe("the notification catalogue", () => {
  it("has a unique type key for every entry", () => {
    expect(new Set(ALL_NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
  });

  it("gives every entry something to show a reader", () => {
    for (const def of NOTIFICATION_TYPES) {
      expect(def.label.length, `${def.type} has no label`).toBeGreaterThan(0);
      expect(def.description.length, `${def.type} has no description`).toBeGreaterThan(0);
      // The description ends up under the label on the preference screen, where a
      // fragment reads as a mistake.
      expect(def.description.endsWith("."), `${def.type}'s description is not a sentence`).toBe(
        true,
      );
    }
  });

  it("only defaults to channels that exist", () => {
    for (const def of NOTIFICATION_TYPES) {
      for (const channel of def.defaultChannels) {
        expect(NOTIFICATION_CHANNELS, `${def.type} defaults to ${channel}`).toContain(channel);
      }
    }
  });

  it("puts every type in the inbox by default", () => {
    // In-app is the floor: the bell has to be a complete record, or "I was never
    // told" has no answer. A type that leaves it out is a mistake, not a choice.
    for (const def of NOTIFICATION_TYPES) {
      expect(def.defaultChannels, `${def.type} is not in the inbox by default`).toContain("inapp");
    }
  });

  it("only uses audiences that exist", () => {
    for (const def of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_AUDIENCES, `${def.type} has an unknown audience`).toContain(def.audience);
    }
  });

  it("gives every operators type the permission that defines them", () => {
    // `operators` is the one audience with no subject to resolve from — it is
    // "whoever holds this". Without the permission the audience resolves to
    // nobody, and a notification with no recipients fails by being silent.
    for (const def of NOTIFICATION_TYPES.filter((d) => d.audience === "operators")) {
      expect(def.permission, `${def.type} names no permission`).toBeTruthy();
    }
    // And the reverse: a permission on any other audience is a leftover that
    // reads as though it narrows the recipients when it does nothing at all.
    for (const def of NOTIFICATION_TYPES.filter((d) => d.audience !== "operators")) {
      expect(def.permission, `${def.type} carries a permission it never uses`).toBeUndefined();
    }
  });

  it("keeps every type inside a declared category", () => {
    // The categories are the section headings on both configuration screens. A
    // type in an unlisted one renders under no heading at all.
    for (const def of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_CATEGORIES, `${def.type} is in an unknown category`).toContain(
        def.category,
      );
    }
  });
});

describe("channel narrowing", () => {
  it("treats in-app as the one channel needing no destination", () => {
    expect(isContactChannel("inapp")).toBe(false);
    expect(asContactChannel("inapp")).toBeNull();
    for (const channel of NOTIFICATION_CHANNELS.filter((c) => c !== "inapp")) {
      expect(isContactChannel(channel)).toBe(true);
      expect(asContactChannel(channel)).toBe(channel);
    }
  });
});

describe("allowedChannelsFor()", () => {
  it("falls back to the declared defaults when the matrix says nothing", () => {
    const def = NOTIFICATION_TYPES[0]!;
    expect(allowedChannelsFor(def.type, {})).toEqual(def.defaultChannels);
  });

  it("lets a stored row replace the defaults, including with nothing", () => {
    const def = NOTIFICATION_TYPES[0]!;
    expect(allowedChannelsFor(def.type, { [def.type]: ["inapp"] })).toEqual(["inapp"]);
    // An empty list is a decision — "this type is off" — not an absent value.
    expect(allowedChannelsFor(def.type, { [def.type]: [] })).toEqual([]);
  });

  it("gives an unknown type nothing rather than everything", () => {
    // A type retired from the catalogue can linger in the stored matrix. It must
    // resolve to no channels: the alternative is a message nobody can configure
    // and nobody expected still being delivered.
    expect(findNotificationType("journal.invented")).toBeUndefined();
    expect(allowedChannelsFor("journal.invented", { "journal.invented": ["email"] })).toEqual([]);
  });
});
