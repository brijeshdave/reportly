-- The cartridge handling report — who fits, who removes, and who services — for
-- installs already running.
--
-- Same shape and reason as 0025, 0032 and 0033: the seed reconciles shipped roles,
-- so a fresh install and anybody running `cli seed` on deploy picks this up without
-- the file. It exists for the deploy that only runs migrations.
INSERT INTO "permissions" ("key", "description")
VALUES ('reports:view:part_handling', 'Run the cartridge handling report')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Granted to whoever already reads the cartridge workload report: this answers the
-- question that one cannot, about the people who only ever swap and therefore leave
-- no service event to be counted.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT held."role_id", p."id"
  FROM "role_permissions" held
  JOIN "permissions" workload
    ON workload."id" = held."permission_id"
   AND workload."key" = 'reports:view:part_workload'
  CROSS JOIN "permissions" p
 WHERE p."key" = 'reports:view:part_handling'
ON CONFLICT DO NOTHING;
