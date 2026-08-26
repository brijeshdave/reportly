-- "Journal reviewer" — the role a reporting manager actually needs.
--
-- Reported from use: "as HOD I am able to review all journal points but the
-- reporting managers should also be able to do that — for them there is no way to
-- enter points."
--
-- The scoring rule was never wrong: anyone above the author who holds
-- `journal:appraise` may review. The roles were. That permission lived in exactly
-- two places — the Manager system role and "Journal admin" — and the area role a
-- line manager would hold, "Journal editor", says in its own comment that it "does
-- not score anyone". So the only way to let a manager score their team was to make
-- them a journal administrator, handing over deletion, the shared vocabulary and
-- comment moderation with it.
--
-- Reviewing is a line function, not an administrative one: *who* may score whom is
-- already decided by the reporting line, and this role only says the person does
-- that job. `journal:reject` is deliberately left out — voiding somebody's points
-- stays with the HOD.
--
-- Here rather than only in the seed because production runs `migrate` and never
-- `seed`: a role that exists only in the seed exists only on fresh databases.
INSERT INTO "roles" ("name", "is_system")
VALUES ('Journal reviewer', true)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."name" = 'Journal reviewer'
   AND p."key" IN (
     'journal:read',
     'journal:create',
     'journal:update',
     'journal:appraise',
     'comments:update',
     'attachments:read',
     'attachments:write'
   )
ON CONFLICT DO NOTHING;
