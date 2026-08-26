-- Every entry is a breakdown; "work log" as a *kind* is retired.
--
-- An entry already carries a work-log timeline of its own — who did what, and when
-- — so a separate `work` kind only ever meant "nothing broke here". Two different
-- things shared the words "work log", and people filing ordinary work ended up with
-- entries labelled Kind: WorkLog without meaning to. His decision: "just remove work
-- for now or disable from ui settings so that i can enable later. migrate old
-- records to issue type. so i dont lose anything."
--
-- Nothing is deleted. The rows become issues, keeping their title, dates, work
-- text, status, scores and points; only the kind changes. A converted entry with no
-- severity is given **Informational**, the lowest rung of the ladder, at his
-- instruction — a stated "nothing serious" rather than a blank that later has to be
-- guessed at.
--
-- The kind itself still exists in the schema and the API: the switch
-- `journal.plannedWork` brings it back, named "Planned work" so it no longer
-- collides with the timeline every entry has.
UPDATE journal_entries
   SET severity_id = (
         SELECT id FROM severities
          WHERE lower(name) = 'informational' AND status = 'active'
          ORDER BY order_index
          LIMIT 1
       )
 WHERE kind = 'work'
   AND severity_id IS NULL
   AND EXISTS (
         SELECT 1 FROM severities
          WHERE lower(name) = 'informational' AND status = 'active'
       );
--> statement-breakpoint

UPDATE journal_entries SET kind = 'issue' WHERE kind = 'work';
