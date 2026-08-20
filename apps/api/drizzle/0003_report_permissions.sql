-- One permission per report, replacing `reports:view` and `reports:export`.
--
-- A single `reports:view` meant that granting somebody the downtime figures also
-- handed them the leaderboard, the cartridge register, and — silently — every
-- report added afterwards. Each report now has its own key, and a new one starts
-- granted to nobody.
--
-- **This migration must not take anybody's access away.** It runs on live servers
-- where roles have been curated by hand, so it is additive first and destructive
-- only where the destruction is provably redundant:
--
--   1. insert the new keys (idempotent — re-running changes nothing);
--   2. give every role that could read reports yesterday all seventeen, so its
--      people open the same screens tomorrow;
--   3. only then drop the two old keys, whose grants are now covered.
--
-- Nothing outside the permission tables is touched: no report, saved view,
-- journal entry, user or role is deleted or rewritten.

INSERT INTO "permissions" ("key", "description")
VALUES
  ('reports:view:journal', 'Run and export the journal report (issues & work)'),
  ('reports:view:downtime', 'Run and export the downtime report (outages)'),
  ('reports:view:reliability', 'Run and export the reliability report (MTBF / MTTR)'),
  ('reports:view:leaderboard', 'Run and export the points leaderboard report'),
  ('reports:view:shift_roster', 'Run and export the shift roster report'),
  ('reports:view:shift_changes', 'Run and export the shift changes report'),
  ('reports:view:shift_coverage', 'Run and export the shift coverage report'),
  ('reports:view:shift_attendance', 'Run and export the shift attendance report'),
  ('reports:view:routine_log', 'Run and export the routine log report'),
  ('reports:view:routine_compliance', 'Run and export the routine compliance report'),
  ('reports:view:part_register', 'Run and export the cartridge register'),
  ('reports:view:part_services', 'Run and export the cartridge service log'),
  ('reports:view:part_consumption', 'Run and export the cartridge consumption report'),
  ('reports:view:part_health', 'Run and export the cartridge health report'),
  ('reports:view:printer_health', 'Run and export the printer health report'),
  ('reports:view:part_failures', 'Run and export the cartridge failures report'),
  ('reports:view:part_workload', 'Run and export the cartridge workload report')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Every role that held either old key gets all seventeen. A role that could open
-- the Reports area yesterday opens exactly the same reports today; narrowing one
-- down is then an administrator's deliberate act, not an upgrade's side effect.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", new_p."id"
  FROM "role_permissions" rp
  JOIN "permissions" old_p ON old_p."id" = rp."permission_id"
  CROSS JOIN "permissions" new_p
 WHERE old_p."key" IN ('reports:view', 'reports:export')
   AND new_p."key" LIKE 'reports:view:%'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Now redundant: every grant they carried has been re-issued above. The delete
-- cascades to role_permissions, which is why it comes last.
DELETE FROM "permissions" WHERE "key" IN ('reports:view', 'reports:export');
