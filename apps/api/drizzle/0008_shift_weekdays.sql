-- Which weekdays a shift actually runs.
--
-- Coverage warns about "an active shift with nobody working it today", walking every
-- active shift across every date. A general shift that does not run on Sundays is
-- therefore uncovered every Sunday, for ever — and a warning that is always wrong is
-- one people stop reading, which costs the warnings that are right.
--
-- `runs_on_days` is the weekdays the shift is expected to be staffed, as integers
-- 0–6 with 0 = Sunday, matching JavaScript's `getDay()` and the calendar header the
-- grid already draws. Coverage skips a shift on a day it does not run; the shift
-- roster and coverage reports follow, since they read the same function.
--
-- Defaults to all seven, so every shift that exists today keeps exactly the coverage
-- rule it has now and nothing changes until somebody says a shift is off on Sundays.

ALTER TABLE "shifts"
  ADD COLUMN IF NOT EXISTS "runs_on_days" integer[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}';
