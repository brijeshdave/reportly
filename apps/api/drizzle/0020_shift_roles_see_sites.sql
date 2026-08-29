-- A scheduler has to be able to name the site they are rostering.
--
-- Reported from production: a user in Kosamba and RI-Kosamba "is being shown
-- central schedule but he is not in central... he has no option to select those in
-- menu".
--
-- The cause is a missing grant, not the schedule code. The site picker reads
-- `GET /locations`, which requires `locations:read`, and "Shifts admin" was given
-- `departments:read` and not that. With no sites to offer, the page falls back to
-- the empty selection — and an empty selection *is* the central rota, so the screen
-- showed a real rota for the wrong people rather than an error.
--
-- Nothing is widened by this: the locations list is already scoped to the sites the
-- caller may reach, so a scheduler sees their own plants and no others.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", loc."id"
  FROM "role_permissions" rp
  JOIN "permissions" shifts ON shifts."id" = rp."permission_id"
  CROSS JOIN "permissions" loc
 WHERE shifts."key" IN ('shifts:manage', 'shifts:approve')
   AND loc."key" = 'locations:read'
ON CONFLICT DO NOTHING;
