-- The two page-count reports: what each printer has printed, and what each
-- cartridge has printed.
--
-- Same shape and reason as 0032, 0033 and 0034: the seed reconciles shipped
-- roles, so a fresh install and anybody running `cli seed` on deploy picks this
-- up without the file. It exists for the deploy that only runs migrations —
-- which, as of the permission-catalogue fix, should no longer be any of them, but
-- a migration that is merely redundant costs nothing and one that is missing
-- costs a feature nobody can grant.
INSERT INTO "permissions" ("key", "description")
VALUES
  ('reports:view:printer_pages', 'Run the printer page-count report'),
  ('reports:view:part_pages', 'Run the cartridge page-count report')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Granted to whoever already reads printer health: it is the same audience asking
-- the same thing about the same machines, one by failures and one by output.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT held."role_id", p."id"
  FROM "role_permissions" held
  JOIN "permissions" health
    ON health."id" = held."permission_id"
   AND health."key" = 'reports:view:printer_health'
  CROSS JOIN "permissions" p
 WHERE p."key" IN ('reports:view:printer_pages', 'reports:view:part_pages')
ON CONFLICT DO NOTHING;
