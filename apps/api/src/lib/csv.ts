// Author: Brijesh Dave <https://github.com/brijeshdave>
// CSV encoding for the streamed exports (logs, audit trail).
//
// Two jobs, and the second one is the reason this is a shared module rather than
// a local helper copied into each exporter — it was exactly that, twice, and both
// copies had the same hole.
/**
 * Characters that make a spreadsheet treat a cell as a formula rather than text.
 *
 * Excel, LibreOffice and Google Sheets all evaluate a cell beginning with one of
 * these. Combined with DDE (`=cmd|'/c calc'!A0`) that is remote code execution on
 * the machine of whoever opens the file — and the person opening an audit or log
 * export is, by definition, an administrator.
 *
 * The values reaching these exports are not ours: `POST /logs/client` writes a
 * browser-supplied `msg` straight into the log, and the audit trail carries an
 * actor's name and email. So any account can plant a payload and wait for someone
 * with `logs:view` or `audit:view` to export and open it.
 *
 * Tab and carriage return are included because they are stripped as leading
 * whitespace by some spreadsheet parsers, exposing the character behind them.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Encode one CSV cell: neutralise a leading formula character, then quote.
 *
 * The neutraliser is a leading apostrophe, which spreadsheets consume as "treat
 * the rest as text" and which a plain CSV reader sees as one extra character.
 * That is a visible change to the data, and it is the right trade: the
 * alternative is a file that runs code when an administrator opens it.
 *
 * Note the ORDER. Prefixing has to happen before quoting, or the apostrophe lands
 * outside the quotes and does nothing.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const safe = FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix)) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A whole row, comma-joined and newline-terminated. */
export function csvRow(values: readonly unknown[]): string {
  return `${values.map(csvCell).join(",")}\n`;
}
