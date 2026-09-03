-- A cartridge's site survives being fitted to a printer.
--
-- Reported from production: "when I set it to Kosamba it clears existing install
-- device location and when again install it on device it clears site location.
-- This should be two different things."
--
-- It was one column doing two jobs. `parts.location_id` was read as "which plant's
-- stock this is" by the scoping, and written as "where the object is standing" by
-- the lifecycle — so installing cleared the site, and the edit form refused to set
-- a site on anything installed. Neither could be corrected once the other was set,
-- and worse: an installed cartridge with no site is *unplaced*, which the register
-- deliberately shows to everybody. Scoping stopped applying the moment a cartridge
-- went into a machine.
--
-- The code now leaves the site alone through install, return and scrap. This puts
-- back what the old behaviour erased: every installed cartridge with no site takes
-- the site of the device it is currently in, which is where it demonstrably is.
UPDATE "parts" p
   SET "location_id" = d."location_id"
  FROM "part_placements" pl
  JOIN "devices" d ON d."id" = pl."device_id"
 WHERE pl."part_id" = p."id"
   AND pl."removed_at" IS NULL
   AND p."location_id" IS NULL
   AND d."location_id" IS NOT NULL;
