-- Rescue the work typed on the filing form, for entries filed after the timeline
-- existed but before the filing form wrote to it.
--
-- Migration 0009 moved the old `work_summary`/`work_detail` text into the new work
-- timeline and left the columns in place as a roll-up. What it could not know is that
-- the **create** path went on assigning those columns directly for another twenty-one
-- migrations: an entry filed with "Work done" filled in wrote a roll-up and no item,
-- so its Work log read empty while the setting that demands work was satisfied.
--
-- Fixed in the code, which is what stops it recurring. This is the data that shape
-- left behind: entries carrying work text with nothing on their timeline. They are
-- recent — every one of them was filed since 0009 — so the author and the entry's own
-- times are reliable rather than reconstructed from an unknown era.
--
-- Deliberately the same rescue as 0009, down to the guard and the fallback line. There
-- is one rule in this codebase for turning a pre-timeline roll-up into an item, it was
-- reviewed and tested when it was written, and a second one that differed would be a
-- second answer to the same question.
INSERT INTO "journal_work_logs"
  ("report_id", "user_id", "summary", "detail", "started_at", "finished_at", "created_at")
SELECT
  e."id",
  e."author_id",
  -- A summary is required, so an entry carrying only a detail still gets a usable line.
  COALESCE(NULLIF(e."work_summary", ''), 'Work recorded before the timeline'),
  e."work_detail",
  e."started_at",
  e."ended_at",
  e."created_at"
  FROM "journal_entries" e
 WHERE (
         (e."work_summary" IS NOT NULL AND e."work_summary" <> '')
      OR (e."work_detail" IS NOT NULL AND e."work_detail" <> '')
       )
   -- Bracketed deliberately, for the reason 0009 records: AND binds tighter than OR,
   -- so without the group above, an entry with a summary would skip the guard entirely
   -- and a re-run would copy its work a second time.
   AND NOT EXISTS (
     SELECT 1 FROM "journal_work_logs" w WHERE w."report_id" = e."id"
   );
