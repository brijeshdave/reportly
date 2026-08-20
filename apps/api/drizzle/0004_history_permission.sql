-- `history:read` — the change history of one record, for whoever may read the record.
--
-- The History tab was gated on `audit:view`, which is deliberately admin-only: audit
-- rows carry before/after snapshots of other people's data. That left somebody
-- working a task able to see the task and not what had happened to it, which reads
-- as the history being broken rather than withheld.
--
-- Additive, and it takes nothing away:
--
--   1. insert the key (idempotent);
--   2. give it to every role that already holds `audit:view` — they could see this
--      history yesterday and still can;
--   3. give it to the editor and admin tiers of the shipped area roles, which is
--      where the seed now puts it, so a fresh install and an upgraded one agree.
--
-- `audit:view` itself is untouched: the company-wide trail stays admin-only.

INSERT INTO "permissions" ("key", "description")
VALUES ('history:read', 'See the change history of a record you may already read')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT DISTINCT rp."role_id", new_p."id"
  FROM "role_permissions" rp
  JOIN "permissions" old_p ON old_p."id" = rp."permission_id"
  CROSS JOIN "permissions" new_p
 WHERE old_p."key" = 'audit:view'
   AND new_p."key" = 'history:read'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."is_system" = true
   AND (r."name" LIKE '%editor' OR r."name" LIKE '%admin')
   AND p."key" = 'history:read'
ON CONFLICT DO NOTHING;
