-- What a task is worth, decided per task.
--
-- Asked for after the severity ceiling proved the wrong instrument: "each task
-- should have a points to earn based on how complex a task is and how much effert
-- is needed... there may be some tasks that needs much more points to earn."
--
-- A number on the task rather than a grade from a catalogue, because the range is
-- open-ended: a rebuild worth eighty and a form worth two are both real, and no
-- ladder of four names covers them. The installation-wide ceiling that stops
-- somebody writing themselves a task worth a thousand is a setting, not a column,
-- so it can be raised without a migration.
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "max_points" numeric(6, 1) NOT NULL DEFAULT 10;
