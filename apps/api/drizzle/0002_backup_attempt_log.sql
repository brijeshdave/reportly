-- What each backup attempt actually said.
--
-- A failure recorded only its message, shown as a tooltip on a badge — so the
-- reason a nightly backup stopped working was a hover away on a screen nobody was
-- looking at, and gone entirely once log retention had passed. The output now
-- lives with the attempt it belongs to: self-contained, downloadable, and not
-- dependent on the log database being switched on.
--
-- Redacted before it is written; see features/backups/pg-connection.ts.

ALTER TABLE "backups" ADD COLUMN "log" text;
