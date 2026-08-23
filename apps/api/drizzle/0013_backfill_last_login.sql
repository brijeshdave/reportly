-- Give `last_login_at` a past, from the sessions that already exist.
--
-- Reported from use: "in users table ui I was logged in being shown but beside that
-- there was last seen having nothing". Exactly right — the column is written when
-- somebody signs in, so on the day it ships everybody already signed in has a live
-- session and no timestamp. The row then reads "Signed in — Never", which is a
-- contradiction on its face and reads as a broken screen rather than a new column.
--
-- A session's `created_at` is when that sign-in happened, so the newest session per
-- person is the best answer available. It is a floor, not the truth: somebody who
-- signed out is invisible here and stays NULL until their next sign-in, which is
-- honest — the alternative is inventing a date.
UPDATE users u
   SET last_login_at = newest.created_at
  FROM (
    SELECT user_id, max(created_at) AS created_at
      FROM sessions
     GROUP BY user_id
  ) AS newest
 WHERE newest.user_id = u.id
   AND u.last_login_at IS NULL;
