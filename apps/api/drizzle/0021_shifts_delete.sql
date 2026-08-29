-- `shifts:delete` — remove a month's rota and every shift in it.
--
-- Reported from production: "there is no way to delete a schedule once created.
-- there should be and also a permitted to some superadmin role only for the shift."
--
-- Its own permission rather than part of `shifts:manage`, because building a rota
-- and destroying a published one are different acts: the second takes a month of
-- somebody's planning with it. Ending in `:delete` puts it where the role tiers
-- already put deletion — with a superadmin, and not with the "everything but
-- delete" administrator tier.
INSERT INTO "permissions" ("key", "description")
VALUES ('shifts:delete', 'Delete a month''s schedule and every shift in it')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Superadmin holds everything, and is the only tier that gets a delete.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."name" = 'Superadmin'
   AND p."key" = 'shifts:delete'
ON CONFLICT DO NOTHING;
