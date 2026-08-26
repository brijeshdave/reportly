-- What one entry at this severity may be worth.
--
-- Reported from use: "the points system is not proper as each severity is having 10
-- points and all users are getting 10 points even if the issue is very small".
-- Exactly right: MAX_ENTRY_POINTS is a flat ten for every entry, and severity
-- carried no weight at all — its weight column was deleted years ago for being a
-- stored value nothing read.
--
-- A ceiling rather than a fixed award: two Major jobs are not equally hard, so the
-- severity says how much is *available* and judgement decides how much of it is
-- earned. A tier may still divide its ceiling among several people; it may never
-- exceed it.
--
-- **Every existing severity starts at 10**, which is what the app does today. The
-- upgrade therefore changes nothing until somebody sets the numbers on the
-- Severities screen — his instruction: settable in the UI, and old records
-- unaffected.
ALTER TABLE severities
  ADD COLUMN IF NOT EXISTS max_points numeric(4, 1) NOT NULL DEFAULT 10;
