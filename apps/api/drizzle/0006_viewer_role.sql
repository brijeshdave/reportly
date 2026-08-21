-- The `Viewer` tier, and one deletion put back.
--
-- 1. **Viewer** completes the broad ladder: Superadmin ⊇ Admin ⊇ Manager ⊇ Member ⊇
--    Viewer. It is Member without the filing — every `:read` key and no verb at all —
--    for an auditor, a visiting manager, or a screen on a wall. The management
--    figures (analytics, insights, the leaderboard, the reports) are deliberately
--    NOT in it: each already has a role of its own, and folding them into the
--    read-only tier would make it the widest grant of company figures there is.
--
-- 2. **`comments:delete` returns to Admin.** Migration 0005 stripped every `:delete`
--    from the admin tiers, and caught this one by accident: withdrawing *your own*
--    remark is not removing somebody else's record — that is `comments:moderate`,
--    which stays an administrator's grant either way. The result was a Manager who
--    could withdraw a comment and an Admin who could not. A static test now holds
--    the ladder in shape; this puts the row back on a server that already ran 0005.
--
-- Additive: nothing is deleted, and re-running changes nothing.

INSERT INTO "roles" ("name", "is_system") VALUES ('Viewer', true)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."name" = 'Viewer'
   AND r."is_system" = true
   AND p."key" LIKE '%:read'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."is_system" = true
   AND (r."name" = 'Admin' OR r."name" LIKE '% admin')
   AND p."key" = 'comments:delete'
   -- Only the roles that already grant the other comment verbs: a role with nothing
   -- to do with comments should not acquire one here.
   AND EXISTS (
     SELECT 1
       FROM "role_permissions" rp
       JOIN "permissions" other ON other."id" = rp."permission_id"
      WHERE rp."role_id" = r."id" AND other."key" = 'comments:update'
   )
ON CONFLICT DO NOTHING;
