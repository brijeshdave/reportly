-- Splitting the combined system roles, and moving deletion up a tier.
--
-- Three changes, and only one of them takes anything away:
--
--   1. `Tasks & downtime *` and `Reports & analytics *` each covered two different
--      jobs. They become separate roles. **Every group keeps what it had**: a group
--      holding the combined role comes out holding both halves, so nobody notices
--      the split except by seeing two roles where there was one.
--   2. Every area that can delete gains a `* superadmin` tier, carrying exactly the
--      `:delete` keys its admin used to hold.
--   3. Admin tiers — and the broad `Admin` role — lose `:delete`, `backups:manage`
--      and `debug:toggle`. **This is the one thing that is taken away.** Groups are
--      deliberately NOT promoted to the new superadmin roles: who may delete is a
--      decision for whoever runs the server, not a side effect of an upgrade. After
--      migrating, grant `<area> superadmin` to the groups that should still have it.
--
-- **Every statement below only ever reads or writes a role with `is_system = true`.**
-- Roles are unique by name, so an administrator may already own a role called
-- "Tasks admin" or "Analytics viewer" — names this migration introduces. Without the
-- filter it would grant permissions into *their* role and attach it to groups, which
-- is not a migration's business. Learned the hard way: the first run of this file
-- rewrote four hand-made roles on a development copy of a real database.
--
-- Permissions for the new roles are set here from what the old ones held, and are
-- then reconciled against the seed definitions by `cli seed` — which is the second
-- half of the documented upgrade, and which this migration does not depend on.

-- 1. The new roles. Names are unique, so re-running changes nothing.
INSERT INTO "roles" ("name", "is_system")
VALUES
  ('Tasks viewer', true),
  ('Tasks editor', true),
  ('Tasks admin', true),
  ('Tasks superadmin', true),
  ('Downtime viewer', true),
  ('Downtime recorder', true),
  ('Reports viewer', true),
  ('Reports admin', true),
  ('Analytics viewer', true),
  ('Journal reports viewer', true),
  ('Reliability reports viewer', true),
  ('Shift reports viewer', true),
  ('Routine reports viewer', true),
  ('Cartridge reports viewer', true),
  ('Leaderboard reports viewer', true),
  ('Assets & devices superadmin', true),
  ('Organisation superadmin', true),
  ('Journal superadmin', true),
  ('Access superadmin', true)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- 2. Each superadmin tier starts as a copy of its admin — including the `:delete`
-- keys, which step 5 then takes off the admin. Copied before the strip, on purpose.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT new_r."id", rp."permission_id"
  FROM "roles" old_r
  JOIN "role_permissions" rp ON rp."role_id" = old_r."id"
  JOIN "roles" new_r
    ON new_r."name" = replace(old_r."name", ' admin', ' superadmin')
   AND new_r."is_system" = true
 WHERE old_r."is_system" = true
   AND old_r."name" IN (
   'Assets & devices admin', 'Organisation admin', 'Journal admin', 'Access admin'
 )
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3. The split roles take their half of the combined role's grants, by key prefix —
-- so each new role holds exactly what its people could already do, minus deletion.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT new_r."id", p."id"
  FROM "roles" old_r
  JOIN "role_permissions" rp ON rp."role_id" = old_r."id"
  JOIN "permissions" p ON p."id" = rp."permission_id"
  JOIN (VALUES
    ('Tasks & downtime admin',      'Tasks admin',        'tasks:%'),
    ('Tasks & downtime admin',      'Downtime recorder',  'downtime:%'),
    ('Tasks & downtime editor',     'Tasks admin',        'tasks:%'),
    ('Tasks & downtime editor',     'Downtime recorder',  'downtime:%'),
    ('Tasks & downtime viewer',     'Tasks viewer',       'tasks:%'),
    ('Tasks & downtime viewer',     'Downtime viewer',    'downtime:%'),
    ('Reports & analytics admin',   'Reports admin',      'reports:%'),
    ('Reports & analytics editor',  'Reports admin',      'reports:%'),
    ('Reports & analytics viewer',  'Reports viewer',     'reports:view:%'),
    ('Reports & analytics admin',   'Analytics viewer',   'analytics:%'),
    ('Reports & analytics editor',  'Analytics viewer',   'analytics:%'),
    ('Reports & analytics viewer',  'Analytics viewer',   'analytics:%')
  ) AS m(old_name, new_name, key_pattern) ON m."old_name" = old_r."name"
  JOIN "roles" new_r ON new_r."name" = m."new_name" AND new_r."is_system" = true
 WHERE old_r."is_system" = true
   AND p."key" LIKE m."key_pattern"
   AND p."key" NOT LIKE '%:delete'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The tasks tiers that the split produced: the new `Tasks superadmin` carries the
-- deletion the combined admin held, and `Tasks editor` is read + update, which is the
-- tier that did not exist before — somebody who works the tasks they are given.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  JOIN (VALUES
    ('Tasks superadmin', 'tasks:read'),
    ('Tasks superadmin', 'tasks:create'),
    ('Tasks superadmin', 'tasks:update'),
    ('Tasks superadmin', 'tasks:delete'),
    ('Tasks editor', 'tasks:read'),
    ('Tasks editor', 'tasks:update')
  ) AS t(role_name, key) ON t."role_name" = r."name" AND r."is_system" = true
  JOIN "permissions" p ON p."key" = t."key"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The reports roles also read the journal a report is built from, and the department
-- list its filters offer. Both were part of the combined role; neither is a report.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."is_system" = true
   AND r."name" IN ('Reports viewer', 'Reports admin', 'Analytics viewer')
   AND p."key" IN ('journal:read', 'departments:read')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The report-family viewers: each takes the keys of its own family, and journal:read
-- so the report it opens is not empty.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  JOIN (VALUES
    ('Journal reports viewer',     'reports:view:journal'),
    ('Reliability reports viewer', 'reports:view:downtime'),
    ('Reliability reports viewer', 'reports:view:reliability'),
    ('Shift reports viewer',       'reports:view:shift_roster'),
    ('Shift reports viewer',       'reports:view:shift_changes'),
    ('Shift reports viewer',       'reports:view:shift_coverage'),
    ('Shift reports viewer',       'reports:view:shift_attendance'),
    ('Routine reports viewer',     'reports:view:routine_log'),
    ('Routine reports viewer',     'reports:view:routine_compliance'),
    ('Cartridge reports viewer',   'reports:view:part_register'),
    ('Cartridge reports viewer',   'reports:view:part_services'),
    ('Cartridge reports viewer',   'reports:view:part_consumption'),
    ('Cartridge reports viewer',   'reports:view:part_health'),
    ('Cartridge reports viewer',   'reports:view:printer_health'),
    ('Cartridge reports viewer',   'reports:view:part_failures'),
    ('Cartridge reports viewer',   'reports:view:part_workload'),
    ('Leaderboard reports viewer', 'reports:view:leaderboard')
  ) AS f(role_name, key) ON f."role_name" = r."name" AND r."is_system" = true
  JOIN "permissions" p ON p."key" = f."key"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."is_system" = true
   AND r."name" LIKE '% reports viewer'
   AND p."key" = 'journal:read'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 4. Carry the groups across. This is the step that decides whether anybody loses
-- access on upgrade: a group that held the combined role now holds both halves.
INSERT INTO "group_roles" ("group_id", "role_id")
SELECT gr."group_id", new_r."id"
  FROM "group_roles" gr
  JOIN "roles" old_r ON old_r."id" = gr."role_id"
  JOIN (VALUES
    ('Tasks & downtime admin',     'Tasks admin'),
    ('Tasks & downtime admin',     'Downtime recorder'),
    ('Tasks & downtime editor',    'Tasks admin'),
    ('Tasks & downtime editor',    'Downtime recorder'),
    ('Tasks & downtime viewer',    'Tasks viewer'),
    ('Tasks & downtime viewer',    'Downtime viewer'),
    ('Reports & analytics admin',  'Reports admin'),
    ('Reports & analytics admin',  'Analytics viewer'),
    ('Reports & analytics editor', 'Reports admin'),
    ('Reports & analytics editor', 'Analytics viewer'),
    ('Reports & analytics viewer', 'Reports viewer'),
    ('Reports & analytics viewer', 'Analytics viewer')
  ) AS m(old_name, new_name) ON m."old_name" = old_r."name"
  JOIN "roles" new_r ON new_r."name" = m."new_name" AND new_r."is_system" = true
 WHERE old_r."is_system" = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 5. Deletion leaves the admin tiers. An edit leaves a history behind; a deletion
-- takes the history with it, so it belongs one tier up. Nobody is promoted
-- automatically — see the note at the top.
DELETE FROM "role_permissions" rp
 USING "roles" r, "permissions" p
 WHERE rp."role_id" = r."id"
   AND rp."permission_id" = p."id"
   AND r."is_system" = true
   AND r."name" LIKE '% admin'
   AND p."key" LIKE '%:delete';
--> statement-breakpoint

-- The broad Admin role follows the same rule, plus the two switches that are
-- destructive by nature: restoring over the database, and debug logging everywhere.
DELETE FROM "role_permissions" rp
 USING "roles" r, "permissions" p
 WHERE rp."role_id" = r."id"
   AND rp."permission_id" = p."id"
   AND r."name" = 'Admin'
   AND r."is_system" = true
   AND (p."key" LIKE '%:delete' OR p."key" IN ('backups:manage', 'debug:toggle'));
--> statement-breakpoint

-- 6. Seeing your own standing is not the right to enumerate the organisation. The
-- board's department picker reads /me/departments now, which answers for the caller.
DELETE FROM "role_permissions" rp
 USING "roles" r, "permissions" p
 WHERE rp."role_id" = r."id"
   AND rp."permission_id" = p."id"
   AND r."name" = 'Points & leaderboard viewer'
   AND p."key" = 'departments:read';
--> statement-breakpoint

-- 7. The combined roles are now redundant — every group that held one holds its
-- halves. Deleting cascades to group_roles, which is why it comes last.
DELETE FROM "roles"
 WHERE "is_system" = true
   AND "name" IN (
     'Tasks & downtime admin', 'Tasks & downtime editor', 'Tasks & downtime viewer',
     'Reports & analytics admin', 'Reports & analytics editor', 'Reports & analytics viewer'
   );
