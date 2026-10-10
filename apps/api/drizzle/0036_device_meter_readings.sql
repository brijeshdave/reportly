-- The printer's own counter gets somewhere to live.
--
-- Until now a reading existed only as one of two integers on a placement row, so
-- the counter had no history of its own: nothing could offer the last value when
-- the next cartridge went in, and nothing could tell a plausible reading from one
-- taken off the wrong line of the display. On a live install that left half the
-- closed tours unusable — negative differences where a printer had been swapped, a
-- two-day tour claiming fifty-two thousand pages, and one machine whose readings
-- alternated between two unrelated sequences.
--
-- Backfilled from the placements that already hold readings, so the series starts
-- with everything that was ever recorded rather than from today. The existing
-- columns stay where they are: they are what `pagesFor()` reads, and moving them
-- would be a second change riding on this one.
CREATE TABLE IF NOT EXISTS device_meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  -- The number on the display. Never null: a reading nobody took is no row.
  pages integer NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  -- 'install' | 'removal' | 'manual' | 'reset'. Not equally trusted: a reset marks
  -- the counter starting again, which is the one legitimate way for the series to
  -- go backwards.
  source text NOT NULL,
  placement_id uuid REFERENCES part_placements(id) ON DELETE CASCADE,
  note text,
  read_by text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- "What did this printer last read?" — asked on every install, so it is the index.
CREATE INDEX IF NOT EXISTS device_meter_readings_device_idx
  ON device_meter_readings (device_id, read_at);
--> statement-breakpoint

-- The readings already taken at an install, in the order they were taken.
INSERT INTO device_meter_readings (company_id, device_id, pages, read_at, source, placement_id, read_by)
SELECT pl.company_id, pl.device_id, pl.meter_start, pl.installed_at, 'install', pl.id, pl.installed_by
  FROM part_placements pl
 WHERE pl.meter_start IS NOT NULL;
--> statement-breakpoint

INSERT INTO device_meter_readings (company_id, device_id, pages, read_at, source, placement_id, read_by)
SELECT pl.company_id, pl.device_id, pl.meter_end, COALESCE(pl.removed_at, pl.updated_at), 'removal', pl.id, pl.removed_by
  FROM part_placements pl
 WHERE pl.meter_end IS NOT NULL;
