-- The two workload breakdowns — by severity and by category — for installs already
-- running.
--
-- Same shape and same reason as 0025: the seed reconciles shipped roles, so a fresh
-- install and anybody who runs `cli seed` on deploy picks these up without this
-- file. It exists for the deploy that only runs migrations. A report nobody holds
-- the key for is a report that is shipped and invisible.
INSERT INTO "permissions" ("key", "description")
VALUES
  ('reports:view:dept_workload_severity', 'Run the workload report broken down by severity'),
  ('reports:view:dept_workload_category', 'Run the workload report broken down by category')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Every role that already reads the flat workload report reads its two breakdowns:
-- they are the same people, the same window and the same scoping, cut a different
-- way. Keyed off that one permission rather than "holds all reports", because these
-- answer the question that report already asks and a role built to run it wants
-- them.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT held."role_id", p."id"
  FROM "role_permissions" held
  JOIN "permissions" flat
    ON flat."id" = held."permission_id"
   AND flat."key" = 'reports:view:dept_workload'
  CROSS JOIN "permissions" p
 WHERE p."key" IN (
         'reports:view:dept_workload_severity',
         'reports:view:dept_workload_category'
       )
ON CONFLICT DO NOTHING;
