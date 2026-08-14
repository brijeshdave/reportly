// Author: Brijesh Dave <https://github.com/brijeshdave>
// The import parser in isolation — the rules here are all about malformed input, and
// a bad row must be reported with its line number, never silently become a device.
import { describe, expect, it } from "vitest";

import { buildTemplate, parseCsv, parseXlsx } from "../import-parse.js";

const HEADER = "Name,Identifier,Asset tag,Type,Site,Lives at (asset),Status";

describe("parseCsv", () => {
  it("reads a well-formed file into rows", () => {
    const { rows, problems } = parseCsv(`${HEADER}\nPump 1,SN-1,AT-1,Pump,Plant A,Line 3,active`);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Pump 1",
      identifier: "SN-1",
      type: "Pump",
      site: "Plant A",
      asset: "Line 3",
      status: "active",
      line: 2,
    });
  });

  it("requires a name, and points at the offending line", () => {
    const { rows, problems } = parseCsv(`${HEADER}\n,SN-2,,,,,`);
    expect(rows).toEqual([]);
    expect(problems).toEqual([{ line: 2, message: "Name is required" }]);
  });

  it("rejects a status that is neither active nor inactive", () => {
    const { problems } = parseCsv(`${HEADER}\nPump 1,,,,,,broken`);
    expect(problems[0]!.message).toContain("active");
    expect(problems[0]!.line).toBe(2);
  });

  it("refuses a file with no Name column", () => {
    const { problems } = parseCsv("Serial,Type\nSN-1,Pump");
    expect(problems[0]!.message).toContain("Name");
  });

  it("skips blank lines rather than reporting them", () => {
    const { rows, problems } = parseCsv(`${HEADER}\nPump 1,,,,,,\n\n\n`);
    expect(rows).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  it("honours quoted fields that contain a comma", () => {
    const { rows } = parseCsv(`${HEADER}\n"Pump, big",,,,,,`);
    expect(rows[0]!.name).toBe("Pump, big");
  });

  it("matches headers case-insensitively and trims a BOM", () => {
    const { rows, problems } = parseCsv("﻿name,identifier\nPump 1,SN-9");
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({ name: "Pump 1", identifier: "SN-9" });
  });
});

describe("the template round-trips", () => {
  it("parses back with its example row and no problems", async () => {
    const buffer = await buildTemplate();
    const { rows, problems } = await parseXlsx(buffer);
    expect(problems).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Vibration sensor 12");
    expect(rows[0]!.type).toBe("Sensor");
  });
});
