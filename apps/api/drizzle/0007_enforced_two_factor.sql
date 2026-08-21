-- Compulsory two-factor: a flag per group, and a clock per person.
--
-- `groups.requires_two_factor` is the one people actually reach for — "everybody in
-- Admins enrols" is a policy somebody can state, in a way that "everybody in the
-- company" often is not. It sits on the group rather than on the role because a role
-- is a bundle of permissions and this is not a permission: it says how you must
-- prove who you are, not what you may then do.
--
-- `users.two_factor_required_since` is what the grace period counts from. It has to
-- be per person rather than a single "when the setting changed", because somebody
-- added to a required group in month three would otherwise be past a deadline that
-- expired before they were ever subject to it — locked out on their first day, by a
-- countdown they never saw. NULL means the requirement does not apply yet; it is
-- stamped the first time it does, and cleared if it stops applying.
--
-- Additive and reversible: both default to the pre-feature behaviour, so applying
-- this migration alone changes nothing for anybody until the setting is turned on
-- or a group is ticked.

ALTER TABLE "groups"
  ADD COLUMN IF NOT EXISTS "requires_two_factor" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "two_factor_required_since" timestamptz;
