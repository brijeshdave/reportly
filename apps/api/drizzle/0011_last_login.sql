-- When somebody last signed in.
--
-- A column rather than something derived from the sessions table, because sessions
-- are deleted on sign-out and on expiry — so "last seen" computed from them would
-- quietly read "never" for anybody who signs out properly, which is exactly
-- backwards.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- "Who has not been here for months" sorts and filters on it.
CREATE INDEX IF NOT EXISTS users_last_login_idx ON users (last_login_at);
