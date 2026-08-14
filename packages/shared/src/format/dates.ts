// Author: Brijesh Dave <https://github.com/brijeshdave>
// One date format for the whole product: DD-MM-YYYY. Kept in shared so the web
// screens, the printed report, and the API's Excel/HTML exports all read a date the
// same way — a report a manager prints must match what they saw on screen. Formats
// in local time, which in the browser is the viewer's day and on the server (exports)
// is the host's; both render the same DD-MM-YYYY shape.
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A date as DD-MM-YYYY. Null/invalid → "—", so a table cell never shows "NaN". */
export function formatDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** A date and time as DD-MM-YYYY HH:mm (24-hour). Null/invalid → "—". */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Shifts store their times as minutes from local midnight (0–1439), so overlap and
// duration are plain arithmetic. These two convert to and from the "HH:mm" a person
// types, kept here so the web form and the printed calendar read a time the same way.

/** Minutes-from-midnight (0–1439) as "HH:mm" (24-hour). */
export function formatMinutesOfDay(minute: number): string {
  const m = ((Math.trunc(minute) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** "HH:mm" → minutes-from-midnight, or null if it is not a valid time of day. */
export function parseMinutesOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
