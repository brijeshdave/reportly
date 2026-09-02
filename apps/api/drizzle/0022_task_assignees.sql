-- A task may have several people on it, or nobody yet.
--
-- Three reports, one shape:
--
--   "tasks needs to be assigned to multiple users but own task should be only to
--    himself"
--   "allow to create the task without any assign to so that i can create task in
--    advance for my team and only assign when i need to based on priority"
--   "allow the tasks to be handover as there may be a case when task was long and
--    user's shift was finished and he handedover it to someone else"
--
-- `tasks.assignee_id` could express none of them: it is one person, and NOT NULL.
-- The join table becomes the truth and the column goes, rather than both existing
-- and disagreeing about whose task it is — a fault this project has had before.
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the person hands the task on. They stay a row rather than being
  -- deleted, because the points for a task handed over mid-shift are split
  -- between both people, and a deleted row cannot be paid.
  released_at timestamptz,
  PRIMARY KEY (task_id, user_id)
);
--> statement-breakpoint

-- "What is on my plate", which is the read this table exists to serve.
CREATE INDEX IF NOT EXISTS task_assignees_user_idx ON task_assignees (user_id)
  WHERE released_at IS NULL;
--> statement-breakpoint

-- Everyone currently on a task keeps it. Nothing is assigned to nobody by this
-- migration: an existing task has exactly one person and ends with exactly one.
INSERT INTO task_assignees (task_id, user_id)
SELECT id, assignee_id FROM tasks
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DROP INDEX IF EXISTS tasks_assignee_state_idx;
--> statement-breakpoint

ALTER TABLE tasks DROP COLUMN IF EXISTS assignee_id;
--> statement-breakpoint

-- The state half of the old index still earns its keep on its own.
CREATE INDEX IF NOT EXISTS tasks_state_idx ON tasks (state);
--> statement-breakpoint

-- Why a task changed hands, in the shape journal handovers already use: a task
-- moved at the end of a shift is a fact about the work, not a silent edit to a
-- row, and the person who asked for the move is part of the record.
CREATE TABLE IF NOT EXISTS task_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_user_id text REFERENCES users(id) ON DELETE SET NULL,
  to_user_id text REFERENCES users(id) ON DELETE SET NULL,
  by_user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason text,
  handed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS task_handovers_task_idx ON task_handovers (task_id, handed_at);
