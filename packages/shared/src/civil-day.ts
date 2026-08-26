// Author: Brijesh Dave <https://github.com/brijeshdave>
// Which calendar day an instant falls on, somewhere in particular.
//
// `new Date().toISOString().slice(0, 10)` is the day in **UTC**, and it was how the
// server decided which day a routine occurrence belonged to and which day points
// were earned on. At +05:30 that is wrong for the first five and a half hours of
// every day: work done at 1am on the 24th was filed against the 23rd, and the
// person who did it had no way to see why.
//
// `Intl` is used rather than a date library because the runtime already ships a
// timezone database, and it knows about summer time — which a stored offset never
// can.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * The `YYYY-MM-DD` an instant falls on in `timeZone`.
 *
 * `en-CA` because its short date format *is* ISO, which avoids assembling the
 * parts by hand. An unknown zone falls back to UTC rather than throwing: a bad
 * setting should make the day wrong in the same way it is wrong today, not stop
 * somebody logging their work.
 */
export function civilDay(instant: Date, timeZone: string): string {
  try {
    return formatterFor(timeZone).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** Today, where the installation lives. */
export function todayIn(timeZone: string): string {
  return civilDay(new Date(), timeZone);
}
