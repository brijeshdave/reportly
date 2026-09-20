-- A task says which site the work is for.
--
-- Asked for from use: "in journal or task or any place need location or site to be
-- shown in table column always". A journal entry has carried a site since location
-- scoping; the task that asked for the work carried none — so the intent and the
-- record of the same job could not be asked the same question, and no list of tasks
-- could be narrowed to a plant.
--
-- Nullable, and left null for every task that already exists. The obvious backfill
-- is the raiser's own site, and it is wrong: it would state a fact about work that
-- was never filed against a site, and nobody could tell the stated ones from the
-- guessed ones afterwards.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "location_id" uuid;

ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_location_id_locations_id_fk";
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_location_id_locations_id_fk"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE set null;

-- Every task list is narrowed by site now, the same way reports and devices are.
CREATE INDEX IF NOT EXISTS "tasks_location_idx" ON "tasks" ("location_id");
