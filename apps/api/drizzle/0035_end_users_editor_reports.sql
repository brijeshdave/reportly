-- The End users editor tier was missing the two reports its own viewer holds.
--
-- The ladder is meant to nest: a viewer who can do something the editor above them
-- cannot is a mistake, and there is a seed test saying so — it has been red since
-- the end-user reports shipped. Somebody maintaining the register could not open
-- the figures built from it while somebody who only reads it could.
--
-- The seed reconciles shipped roles, so a fresh install and anybody who runs
-- `cli seed` on deploy picks this up without the file. It exists for the deploy
-- that only runs migrations.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."name" = 'End users editor'
   AND p."key" IN ('reports:view:end_user_summary', 'reports:view:end_user_issues')
ON CONFLICT DO NOTHING;
