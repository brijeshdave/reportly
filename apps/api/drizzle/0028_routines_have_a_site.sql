-- A routine says which site its duty belongs to.
--
-- Asked for from use: "but routines also need sites in config". The same rounds at
-- two plants are two routines, and a monthly review that cannot say which plant kept
-- up is not reporting on either. Tasks gained a site in 0027 for the same reason.
--
-- Nullable, and left null for every routine that already exists. The obvious
-- backfill — the owning department's site — is wrong for a department that spans
-- plants, and nobody could afterwards tell a stated site from a guessed one. The
-- management pack falls back to the site of whoever completed an occurrence, so old
-- routines still report somewhere sensible until they are edited.
ALTER TABLE "routines" ADD COLUMN IF NOT EXISTS "location_id" uuid;

ALTER TABLE "routines" DROP CONSTRAINT IF EXISTS "routines_location_id_locations_id_fk";
ALTER TABLE "routines"
  ADD CONSTRAINT "routines_location_id_locations_id_fk"
  FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE set null;

CREATE INDEX IF NOT EXISTS "routines_location_idx" ON "routines" ("location_id");
