-- The people the IT team supports, who do not themselves use Reportly.
--
-- Asked for from use: the journal's "People" field listed Reportly accounts, so
-- technicians tagged colleagues — 206 targets naming 13 accounts — because that was
-- the only list available. The people the work was actually about were not recorded
-- anywhere, which is why no report could answer "who keeps raising this".
--
-- A table of its own rather than a flag on `users`: an end user has no password, no
-- company access, no place in the reporting line, no points and no inbox, and a flag
-- would oblige every surface that reads people to exclude them one by one.
CREATE TABLE IF NOT EXISTS "end_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "department_id" uuid,
  "full_name" text NOT NULL,
  "employee_number" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "linked_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "end_users" DROP CONSTRAINT IF EXISTS "end_users_company_id_companies_id_fk";
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade;

ALTER TABLE "end_users" DROP CONSTRAINT IF EXISTS "end_users_department_id_departments_id_fk";
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_department_id_departments_id_fk"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE set null;

ALTER TABLE "end_users" DROP CONSTRAINT IF EXISTS "end_users_linked_user_id_users_id_fk";
ALTER TABLE "end_users" ADD CONSTRAINT "end_users_linked_user_id_users_id_fk"
  FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE set null;

-- The employee number is how a person is told apart, so it is required and unique
-- within the company. Two companies may legitimately reuse a number.
ALTER TABLE "end_users" DROP CONSTRAINT IF EXISTS "end_users_company_employee_number_unique";
ALTER TABLE "end_users"
  ADD CONSTRAINT "end_users_company_employee_number_unique" UNIQUE ("company_id", "employee_number");

CREATE INDEX IF NOT EXISTS "end_users_company_status_idx" ON "end_users" ("company_id", "status");
CREATE INDEX IF NOT EXISTS "end_users_department_idx" ON "end_users" ("department_id");
