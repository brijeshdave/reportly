-- A rota belongs to a site as well as a department.
--
-- Until now `schedules` was unique on (department_id, year, month): one rota per
-- department per month, shared by teams that never work in the same building, and
-- swap candidates drawn from all of them. Sites were recorded per membership all
-- along (department_user_locations) and the rota never looked.
--
-- A NULL location_id is deliberate and meaningful: it is the *central* rota, for
-- people who travel rather than belong to one site. That is why the uniqueness
-- uses NULLS NOT DISTINCT — without it Postgres would allow any number of central
-- rotas for the same department and month.

ALTER TABLE "schedules"
  ADD COLUMN "location_id" uuid REFERENCES "locations" ("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Existing rotas predate sites, so each needs a home. Attach one where the answer
-- is unambiguous — the department's people all sit at a single site, or the whole
-- company has only one — and leave the rest central, where they stay readable.
-- Nothing is deleted: a published rota is a record of who worked when.
UPDATE "schedules" s
   SET "location_id" = one.location_id
  FROM (
    SELECT dul.department_id, (array_agg(DISTINCT dul.location_id))[1] AS location_id
      FROM "department_user_locations" dul
     GROUP BY dul.department_id
    HAVING COUNT(DISTINCT dul.location_id) = 1
  ) one
 WHERE one.department_id = s.department_id;
--> statement-breakpoint

UPDATE "schedules" s
   SET "location_id" = one.location_id
  FROM (
    SELECT l.company_id, (array_agg(l.id))[1] AS location_id
      FROM "locations" l
     WHERE l.status = 'active'
     GROUP BY l.company_id
    HAVING COUNT(*) = 1
  ) one
 WHERE one.company_id = s.company_id
   AND s."location_id" IS NULL;
--> statement-breakpoint

ALTER TABLE "schedules" DROP CONSTRAINT IF EXISTS "schedules_dept_month_unique";
--> statement-breakpoint

ALTER TABLE "schedules"
  ADD CONSTRAINT "schedules_dept_site_month_unique"
  UNIQUE NULLS NOT DISTINCT ("department_id", "location_id", "year", "month");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "schedules_location_idx" ON "schedules" ("location_id");
--> statement-breakpoint

-- Who travels. Explicit rather than inferred from "has no sites": an empty site
-- set already means *all* sites elsewhere in the app, so inferring would silently
-- reclassify anybody an administrator had not finished placing.
ALTER TABLE "department_users"
  ADD COLUMN "is_central" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- Where a central person was that day. An indication for whoever reads the rota —
-- "Plant A", or "Plant A + Plant B" — never hours, and nothing the system computes
-- with. One cell per person per day stays true.
CREATE TABLE IF NOT EXISTS "schedule_entry_locations" (
  "entry_id" uuid NOT NULL REFERENCES "schedule_entries" ("id") ON DELETE CASCADE,
  "location_id" uuid NOT NULL REFERENCES "locations" ("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "schedule_entry_locations_pk" PRIMARY KEY ("entry_id", "location_id")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "schedule_entry_locations_location_idx"
  ON "schedule_entry_locations" ("location_id");
--> statement-breakpoint

-- A swap across two sites is refused by default. A manager may still force one
-- through for somebody who genuinely covers both — but it is an explicit act with
-- a reason attached, not a quietly different code path.
ALTER TABLE "shift_swap_requests"
  ADD COLUMN "cross_site" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "shift_swap_requests"
  ADD COLUMN "cross_site_reason" text;
