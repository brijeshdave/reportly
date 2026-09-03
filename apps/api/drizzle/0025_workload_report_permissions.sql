-- The three department workload reports, for installs already running.
--
-- The seed reconciles shipped roles, so a fresh install and anybody who runs
-- `cli seed` on deploy picks these up without this file. It exists for the deploy
-- that only runs migrations: a report nobody holds the key for is a report that is
-- shipped and invisible, and "why can I not see it" is a poor way to find out.
--
-- The permission rows themselves come from the catalogue on seed; this grants them
-- only where they already exist, so it is safe to run in either order.
INSERT INTO "permissions" ("key", "description")
VALUES
  ('reports:view:dept_workload', 'Run the department workload report'),
  ('reports:view:dept_workload_daily', 'Run the department workload report, day by day'),
  ('reports:view:dept_irregularity', 'Run the irregularity report')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Every role that already reads *every* shipped report reads these too. Expressed
-- as "holds all of them" rather than by name, so a role an administrator built to
-- see everything is included and one with a narrow selection is not.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE p."key" IN (
         'reports:view:dept_workload',
         'reports:view:dept_workload_daily',
         'reports:view:dept_irregularity'
       )
   AND NOT EXISTS (
     SELECT 1
       FROM "permissions" existing
      WHERE existing."key" LIKE 'reports:view:%'
        AND existing."key" NOT LIKE 'reports:view:dept_%'
        AND NOT EXISTS (
          SELECT 1 FROM "role_permissions" held
           WHERE held."role_id" = r."id" AND held."permission_id" = existing."id"
        )
   )
ON CONFLICT DO NOTHING;
