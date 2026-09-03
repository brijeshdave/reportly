-- An organisation admin could not read the list of sites it administers.
--
-- The role held locations:create, :update, :delete and :import — everything except
-- locations:read — while the editor tier below it did hold the read. The static
-- subset guard exists for exactly that shape ("a viewer who can do something their
-- admin cannot is a mistake, every time") and it caught this one the first time the
-- whole integration suite was run after the access re-cut.
--
-- The seed fixes new installs; this fixes the ones already running. Nothing is
-- widened: the locations list is scoped to the sites the caller may reach, so an
-- organisation admin sees their own and no others.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."name" = 'Organisation admin'
   AND p."key" = 'locations:read'
ON CONFLICT DO NOTHING;
