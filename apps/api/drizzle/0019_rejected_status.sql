-- A status that says "rejected", because that is what happened.
--
-- Rejecting moves an entry into the workflow's rejected group, and picked whichever
-- status in that group sorted first. On a default install that is **Duplicate** —
-- so a manager refusing sloppy work marked it a duplicate of nothing, which is a
-- statement about the entry that nobody made. Reported as: "currently rejected
-- journal being set to duplicate status. but there should be rejected status
-- instead."
--
-- Inserted only when no such status exists, and never re-inserted: an installation
-- that renames or deletes it later keeps that decision. (Re-creating deleted
-- statuses on every upgrade is a fault this project has already had once.)
INSERT INTO "journal_statuses" ("name", "group", "is_terminal", "order_index")
SELECT 'Rejected', 'rejected', true,
       COALESCE((SELECT MAX(order_index) FROM journal_statuses), 0) + 1
 WHERE NOT EXISTS (
   SELECT 1 FROM journal_statuses WHERE lower(name) = 'rejected'
 );
