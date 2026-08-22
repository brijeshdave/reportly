-- Work becomes a timeline: who did what, and when.
--
-- A journal entry carried one pair of `work_summary`/`work_detail` columns. That is
-- enough for "here is what I did" and nothing else: a job worked over two shifts by
-- three people has no room for a *time*, and appending each new note to the same
-- column turns the record into a run-on paragraph that the editor then shows back as
-- one unreadable field.
--
-- **Nothing is thrown away.** The old columns stay and keep their meaning: every
-- report, export and saved report-view reads `work_summary`, and emptying it would
-- blank a column in reports people have already built. From here the server keeps it
-- as a roll-up of the newest item; the text below is rescued into the first item so an
-- entry filed last week reads the same afterwards, in the new shape.

CREATE TABLE IF NOT EXISTS "journal_work_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "report_id" uuid NOT NULL REFERENCES "journal_entries"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "summary" text NOT NULL,
  "detail" text,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "work_logs_report_idx"
  ON "journal_work_logs" ("report_id", "started_at", "created_at");
--> statement-breakpoint

-- Rescue what is already written. Attributed to the author — they are the only person
-- the old shape could have meant — and timed from the entry's own start and finish
-- where those were filled in, which is the closest thing to a truthful timestamp the
-- old data holds.
--
-- Idempotent: an entry that already has an item is left alone, so re-running adds
-- nothing and a second migration attempt cannot duplicate anybody's work.
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
   -- Bracketed deliberately: AND binds tighter than OR, so without the group above
   -- this guard would only have covered the entries with a detail, and a re-run would
   -- have duplicated every entry that had a summary.
   AND NOT EXISTS (
     SELECT 1 FROM "journal_work_logs" w WHERE w."report_id" = e."id"
   );
