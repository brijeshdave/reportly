-- Rejecting an entry moves it out of "Resolved", and can be undone.
--
-- Reported from use: "currently rejected stays with status of whatever it has even
-- if it is resolved". Rejecting set a flag and left the status alone, so the entry
-- read "Resolved" and "rejected" at once — two answers to the same question.
--
-- Rejecting now moves the entry into the workflow's own rejected group (whatever
-- the organisation has named those statuses; nothing new is invented here, because
-- the vocabulary is theirs). This column remembers where it came from, so lifting a
-- rejection puts it back rather than guessing at "Resolved" — which would be wrong
-- for anything rejected while still in progress.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS rejected_from_status_id uuid REFERENCES journal_statuses(id) ON DELETE SET NULL;
--> statement-breakpoint

-- A reporting manager may refuse their own team's work, not only the HOD: scoring
-- it and refusing it are the same judgement, and "Journal reviewer" is the role
-- that says somebody does that job.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."name" = 'Journal reviewer'
   AND p."key" = 'journal:reject'
ON CONFLICT DO NOTHING;
