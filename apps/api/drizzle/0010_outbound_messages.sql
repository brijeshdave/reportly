-- Outbound messages: what Reportly sent, where, and whether it arrived.
--
-- Written by the code that does the sending — the email worker and the channel
-- senders — rather than by each caller, because the next caller added would
-- forget. The body is never stored: a reset email carries a working link, and a
-- log that keeps it outlives the token it contains.
CREATE TABLE IF NOT EXISTS outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  kind text NOT NULL,
  event_type text,
  -- text, not uuid: better-auth owns the users table and its ids are text.
  to_user_id text REFERENCES users(id) ON DELETE SET NULL,
  -- Null for a message about the installation rather than a tenant: a password
  -- reset belongs to a person, not to a company. Scoping follows the audit trail
  -- — a tenant sees its own rows plus the system ones, and nobody else's.
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  -- Redacted at the point of writing, not at the point of display: a row that
  -- never held the address cannot leak it later.
  destination text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'queued',
  error text,
  attempts integer NOT NULL DEFAULT 0,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The two questions this table is opened to answer: "what happened lately?" and
-- "did anything reach this person?"
CREATE INDEX IF NOT EXISTS outbound_messages_queued_at_idx ON outbound_messages (queued_at DESC);
CREATE INDEX IF NOT EXISTS outbound_messages_to_user_idx ON outbound_messages (to_user_id, queued_at DESC);
-- Retention prunes by age within a channel, and the failures screen filters by status.
CREATE INDEX IF NOT EXISTS outbound_messages_channel_status_idx ON outbound_messages (channel, status);
CREATE INDEX IF NOT EXISTS outbound_messages_company_idx ON outbound_messages (company_id, queued_at DESC);
