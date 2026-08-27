-- `tasks:create-own` — give yourself work, and only yourself.
--
-- Asked for from use: "a user should be alowed to create task for him self and can
-- not be assigned to others by him but his upper level can do so."
--
-- `tasks:create` cannot say that. It means "yourself or anyone below you in the
-- reporting line", so granting it to a member who happens to have somebody under
-- them would let them hand work downward — the opposite of the request. This is the
-- narrow half, the same shape as `routines:log` beside `routines:manage`.
--
-- Additive: managers keep `tasks:create` and nothing they do changes.
INSERT INTO "permissions" ("key", "description")
VALUES ('tasks:create-own', 'Create a task for yourself, and no one else')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Everyone who already files their own work gets it: the shipped Member tier, and
-- the job-shaped roles that stand in the same place.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", new_p."id"
  FROM "role_permissions" rp
  JOIN "permissions" old_p ON old_p."id" = rp."permission_id"
  CROSS JOIN "permissions" new_p
 WHERE old_p."key" = 'tasks:update'
   AND new_p."key" = 'tasks:create-own'
ON CONFLICT DO NOTHING;
