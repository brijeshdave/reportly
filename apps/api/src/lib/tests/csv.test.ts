// Author: Brijesh Dave <https://github.com/brijeshdave>
// CSV encoding, and specifically the formula-injection guard. The exported log
// and audit rows carry values a user supplied — a client log's `msg`, an actor's
// name — so a cell that a spreadsheet evaluates is code running on the machine of
// whoever opens the export, which is an administrator.
import { describe, expect, it } from "vitest";

import { csvCell, csvRow } from "@/lib/csv.js";

describe("csvCell", () => {
  it("leaves ordinary text alone", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
  });

  it("renders null and undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and escapes what CSV requires", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("neutralises every character that starts a formula", () => {
    // The DDE payload is the one that matters: opened in Excel it runs a program.
    expect(csvCell("=cmd|'/c calc'!A0")).toBe("'=cmd|'/c calc'!A0");
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tSUM")).toBe("'\tSUM");
    expect(csvCell("\rSUM")).toBe(`"'\rSUM"`);
  });

  it("puts the guard INSIDE the quotes", () => {
    // Order matters: prefix then quote. The other way round leaves the apostrophe
    // outside the quoted field, where it neutralises nothing.
    const encoded = csvCell('=HYPERLINK("http://evil","click")');
    expect(encoded.startsWith(`"'=`)).toBe(true);
  });

  it("does not mistake a minus sign inside a value for a leading one", () => {
    expect(csvCell("a-b")).toBe("a-b");
    expect(csvCell("2026-08-07T00:00:00Z")).toBe("2026-08-07T00:00:00Z");
  });

  it("still neutralises a negative number, which is the cost of the guard", () => {
    // A genuine "-5" gains an apostrophe. Accepted deliberately: these exports
    // are records, not spreadsheets to compute over, and the alternative is a
    // file that can execute.
    expect(csvCell(-5)).toBe("'-5");
  });
});

describe("csvRow", () => {
  it("joins, terminates, and encodes every cell", () => {
    expect(csvRow(["a", "b,c", "=x"])).toBe(`a,"b,c",'=x\n`);
  });
});
