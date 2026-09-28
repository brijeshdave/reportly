-- The silence report — who has logged nothing, and for how long — for installs
-- already running.
--
-- Same shape and same reason as 0025 and 0032: the seed reconciles shipped roles,
-- so a fresh install and anybody who runs `cli seed` on deploy picks this up
-- without the file. It exists for the deploy that only runs migrations.
INSERT INTO "permissions" ("key", "description")
VALUES ('reports:view:dept_silence', 'Run the report of people who have logged nothing')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Granted to whoever already reads the irregularity report. They are the same
-- question asked two ways — "did very little" and "has done nothing since" — and a
-- role built to chase one wants the other.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT held."role_id", p."id"
  FROM "role_permissions" held
  JOIN "permissions" irregular
    ON irregular."id" = held."permission_id"
   AND irregular."key" = 'reports:view:dept_irregularity'
  CROSS JOIN "permissions" p
 WHERE p."key" = 'reports:view:dept_silence'
ON CONFLICT DO NOTHING;
