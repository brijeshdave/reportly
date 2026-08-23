// Author: Brijesh Dave <https://github.com/brijeshdave>
// The admin form is generated from these descriptors, so a field the introspector
// mis-reads becomes a control that writes a value the schema then rejects. Every
// real registry schema is checked, not just synthetic ones.
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  LOG_LEVELS,
  LOG_LEVEL_SETTINGS,
  LOG_SINKS,
  PASSWORD_POLICY,
  SESSION_SETTINGS,
  TABLE_DEFAULTS,
  UPLOAD_LIMITS,
  UI_THEME,
  ALL_SETTING_DEFS,
  defaultFor,
} from "@/settings/registry.js";
import { describeSettingSchema, humanizeKey } from "@/settings/fields.js";

const fieldsOf = (def: { schema: Parameters<typeof describeSettingSchema>[0] }) =>
  describeSettingSchema(def.schema);

describe("humanizeKey", () => {
  it("turns a camelCase key into a sentence", () => {
    expect(humanizeKey("expiresInSeconds")).toBe("Expires in seconds");
    expect(humanizeKey("requireUppercase")).toBe("Require uppercase");
    expect(humanizeKey("console")).toBe("Console");
  });
});

describe("describeSettingSchema", () => {
  it("reads numbers with their integer and range constraints", () => {
    const fields = fieldsOf(PASSWORD_POLICY);
    const minLength = fields.find((field) => field.key === "minLength");

    expect(minLength).toMatchObject({ kind: "number", integer: true, min: 8, max: 128 });
  });

  it("reads booleans", () => {
    const fields = fieldsOf(PASSWORD_POLICY);
    expect(fields.find((field) => field.key === "requireUppercase")).toMatchObject({
      kind: "boolean",
    });
  });

  it("reads enums with their allowed values", () => {
    const fields = fieldsOf(UI_THEME);
    const mode = fields.find((field) => field.key === "mode");

    expect(mode?.kind).toBe("enum");
    expect(mode?.options).toEqual(expect.arrayContaining(["light", "dark", "system"]));
  });

  it("reads a record and the enum its values are drawn from", () => {
    const fields = fieldsOf(LOG_LEVEL_SETTINGS);
    const features = fields.find((field) => field.key === "features");

    expect(features?.kind).toBe("record");
    expect(features?.options).toEqual([...LOG_LEVELS]);
  });

  it("keeps the declaration order of the schema", () => {
    expect(fieldsOf(LOG_SINKS).map((field) => field.key)).toEqual(["console", "file", "database"]);
  });

  it("has a lower bound for every constrained number", () => {
    const expiry = fieldsOf(SESSION_SETTINGS).find((f) => f.key === "expiresInSeconds");
    expect(expiry).toMatchObject({ kind: "number", min: 300 });
  });

  it("describes every field of every registered setting", () => {
    for (const def of ALL_SETTING_DEFS) {
      const fields = describeSettingSchema(def.schema);
      const keys = Object.keys(defaultFor(def) as Record<string, unknown>);

      expect(fields.map((field) => field.key)).toEqual(keys);
    }
  });

  it("renders every field as something a person can actually edit", () => {
    // `string` is both the right kind for a real z.string() *and* the fallback for a
    // type the describer does not know — so this is an inventory, not a ban. Every
    // entry below is a genuine free-text value. A new name appearing here is the
    // question worth asking: is it text, or is it a type nobody taught the editor?
    //
    // That question went unasked once already. `allowedTypes` is an array; it fell
    // back to a text input, which handed a string to a schema wanting an array, so
    // the setting could not be saved at all. It is `kind: "list"` now.
    const stringFields = ALL_SETTING_DEFS.flatMap((def) =>
      describeSettingSchema(def.schema)
        .filter((field) => field.kind === "string")
        .map((field) => `${def.namespace}.${def.key}.${field.key}`),
    );

    expect(stringFields).toEqual([
      // Provider credentials and sender addresses — free text by nature.
      "channels.providers.twilioAccountSid",
      "channels.providers.twilioAuthToken",
      "channels.providers.twilioSmsFrom",
      "channels.providers.twilioWhatsappFrom",
      "channels.providers.telegramBotToken",
      "channels.providers.discordBotToken",
      // The points-lock cutoff — a YYYY-MM-DD date (or blank), free text by nature.
      "reports.lock.lockedThrough",
      // An ISO timestamp, and debug has its own toggle rather than a generated form.
      "debug.mode.expiresAt",
    ]);
  });

  it("describes a list of strings as a list, not as text", () => {
    const allowedTypes = fieldsOf(UPLOAD_LIMITS).find((field) => field.key === "allowedTypes");
    expect(allowedTypes).toMatchObject({ kind: "list" });
  });

  it("sees through the refinement wrapping the page size", () => {
    // pageSize is a coerced, refined number; a naive unwrap reads it as a string.
    const pageSize = fieldsOf(TABLE_DEFAULTS).find((field) => field.key === "pageSize");
    expect(pageSize).toMatchObject({ kind: "number", integer: true });
  });

  it("returns nothing for a non-object schema", () => {
    expect(describeSettingSchema(LOG_SINKS.schema.shape.console)).toEqual([]);
  });
});

describe("a record of numbers", () => {
  it("is described as numeric, so the form can offer a number box", () => {
    // Log levels are a record of enum values, and the form renders a `<select>` of
    // them. Retention days are a record of numbers: rendering that same select
    // gave a control with no options — a key you could add and a value you could
    // never set, which made the whole setting unusable.
    const [field] = describeSettingSchema(
      z.object({ perType: z.record(z.string(), z.number().int().min(0).max(3650)).default({}) }),
    );

    expect(field).toMatchObject({ kind: "record", valueKind: "number", integer: true });
    expect(field!.options).toBeUndefined();
  });

  it("still describes a record of enum values by its options", () => {
    const [field] = describeSettingSchema(
      z.object({ features: z.record(z.string(), z.enum(["info", "debug"])).default({}) }),
    );

    expect(field).toMatchObject({ kind: "record", options: ["info", "debug"] });
    expect(field!.valueKind).toBeUndefined();
  });
});
