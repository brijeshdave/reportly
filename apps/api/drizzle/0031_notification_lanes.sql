-- A notification is either a job or a record, and the bell should only count jobs.
--
-- Reported from use: "for in app notifications it should differ from other as
-- currently it is being cluttered with many and I am not able to find on which I
-- should be focusing." In-app defaults on for every type, deliberately, so the bell
-- stays a complete record — which is right for a record and wrong for a signal.
-- Twenty-six types in one list put the thing needing an answer between two things
-- that do not.
--
-- The lane is stored on the row, not looked up from the catalogue when it is read:
-- an administrator may re-edit the catalogue, and a notification has to keep the
-- meaning it was sent with. The same rule messages already follow.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "lane" text NOT NULL DEFAULT 'activity';
--> statement-breakpoint

-- Backfill what is already in people's inboxes, so the split is not empty on the
-- morning it ships. The list is the catalogue's `lane: "action"` types as of this
-- migration; it is written out rather than joined to anything, because a migration
-- must keep working when the catalogue changes underneath it.
UPDATE "notifications" SET "lane" = 'action'
 WHERE "type" IN (
   'journal.assigned',
   'journal.awaiting-review',
   'journal.rejected',
   'task.assigned',
   'task.handover',
   'task.due-soon',
   'routine.due-soon',
   'routine.overdue',
   'shift.swap.requested',
   'part.over-cycle-limit',
   'backup.failed',
   'queue.jobs-failing',
   'security.account-locked',
   'security.two-factor-required',
   'downtime.opened'
 );
--> statement-breakpoint

-- The bell's query is "mine, unread, in this lane, not archived", and it is the
-- most-called query in the app.
CREATE INDEX IF NOT EXISTS "notifications_user_lane_idx"
  ON "notifications" ("user_id", "lane", "read_at");
