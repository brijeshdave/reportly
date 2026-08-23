-- `users:sessions:read` — a colleague's devices, and when they were last here.
--
-- The Sessions tab sat behind plain `users:read`, so anybody who could read the
-- directory could see a person's devices, their addresses and when each was last
-- used. That is attendance data by another name, and it is why the new "Last seen"
-- column needed a permission of its own — gating the column while the tab beside
-- it showed strictly more would have been theatre.
--
-- **This migration is the whole reason the feature works on an existing install.**
-- Production runs `migrate` and never `seed`, so a permission that exists only in
-- the seed exists only on fresh databases: everybody else would hold it nowhere,
-- the tab would quietly disappear, and the column would never be drawn. A
-- permission added without a migration is a feature switched off on every server
-- that already exists.
--
-- Additive, and it takes nothing away from anybody who should keep it:
--
--   1. insert the key (idempotent);
--   2. give it to every role already holding `users:manage-2fa` — the people who
--      help others get in, which is when this is genuinely needed, and who could
--      see the tab yesterday;
--   3. that is deliberately *not* everyone with `users:read`. This is a real
--      tightening: a plain directory reader loses the tab, which is the point.

INSERT INTO "permissions" ("key", "description")
VALUES (
  'users:sessions:read',
  'See a user''s live sessions and when they last signed in'
)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", new_p."id"
  FROM "role_permissions" rp
  JOIN "permissions" old_p ON old_p."id" = rp."permission_id"
  CROSS JOIN "permissions" new_p
 WHERE old_p."key" = 'users:manage-2fa'
   AND new_p."key" = 'users:sessions:read'
ON CONFLICT DO NOTHING;
