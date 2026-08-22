# Changelog

All notable changes to Reportly are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Filing a breakdown no longer asks for the fix at the same time.** Raising an issue
  and recording the work are two moments, and the form asked whoever was sounding the
  alarm to describe work that had not happened yet — which is also why the two tabs
  looked alike: "Work done" was on both. On a new issue the work fields now start
  collapsed behind _"I already did the work"_, so the quick honest entry — belt
  snapped, I replaced it — is still one screen.
- **Work can be logged from the entry itself**, afterwards, with **Log work**. It
  appends rather than replacing, so the second visit does not overwrite the first.
  Until now the work fields were display-only once filed, and the only way to add
  anything was to re-open the whole editor.
- **A closed entry refuses new work.** The appraisal lock is about scoring; this is
  about the ticket being finished, and they are different moments. Re-open it to add
  more — that move is logged, which is the point of making it the way back. Everything
  else about a closed entry stays editable: the rule is about the work record, not a
  general freeze.

### Fixed

- **A handover could only go to yourself or somebody below you**, so anybody without
  subordinates could hand a report to exactly one person: themselves. That is not a
  handover. Work now passes to **a colleague in one of your departments** as well —
  the peer on the next shift is who picks the job up — and the same list feeds
  **who worked on it**, so a co-worker can finally be added. Both pickers read
  `/me/colleagues`, which answers for the caller alone and needs no `users:read`.
- **A new journal entry belongs to whoever filed it.** It used to start held by
  nobody, so every entry asked its author to open a panel and choose their own name —
  a question whose answer was already known.

- **The roster cell is filled edge to edge, rather than holding a coloured badge.**
  The colour sat on a span wrapped around the shift's letter, inside layout wrappers
  that shrink to their contents — so each day showed a small tinted pill with the
  table visible around it. It now sits on the cell itself and the letter is plain
  text on top. A test asserts that, because the same thing has gone wrong twice and
  "the colour area is bad" is a hard report to turn back into a class name.

- **The roster spreadsheet put the weekday and the date in one cell** — "1 Sa", which
  is neither a date nor a weekday, cannot be sorted or referenced, and reads as a
  typo. They are two header rows now, as they are on screen.
- **Calendar cells are filled edge to edge and every box is the same size.** The
  colour sat in a padded pill inside the cell and the boxes took their width from
  their contents, so a row of "W/O" and "A" looked like a broken table rather than a
  rota.
- **A missing `twoFactor` field in a cached session aborted navigation.** The router
  read it without a guard, so the throw surfaced as a blank `ERR_ABORTED` with
  nothing pointing back at the cause.

- **`W/O` split across two lines** in a narrow calendar cell, stacking "W/" above
  "O".

- **A cancelled e2e run no longer breaks every run after it.** Playwright starts the
  API through pnpm, and killing the run took the shell while leaving the server
  listening, so the next `test:e2e` died on "port 3100 is already used". The suite
  now clears its own two ports first — and only ever kills a process belonging to
  this checkout, verified against its working directory and command line. Anything
  else is named and left alone, and a run pointed at somebody else's stack
  (`BASE_URL` set) touches nothing at all.

- **`scripts/upgrade.sh` drove the wrong stack for anyone keeping their own compose
  file.** It passed `-f compose.prod.yaml` explicitly, while an operator who has
  tailored their stack keeps an untracked `compose.yaml` (or `.yml`, or either
  `docker-compose` spelling) precisely so a `git pull` cannot overwrite it — which
  `.gitignore` has always invited. The scripts now find the file instead of assuming
  it: `COMPOSE_FILE` from the environment or `.env`, else **the file the running
  stack was actually started from** (read off the containers' own labels), else the
  four names Compose itself picks up, else the shipped default. The upgrade prints
  which one it chose before it touches anything.

- **Seeding could overwrite an administrator's own role.** Roles are unique by name,
  so a hand-made "Tasks admin" occupies a name a release may later ship. `cli seed`
  looked roles up by name alone and reconciled whatever it found against the shipped
  definition — deleting every permission the definition did not list. The comment
  above that loop had claimed for months that custom roles were untouched; the code
  never checked. It does now: a shipped role that cannot claim its name is skipped,
  the administrator's role is left exactly as they left it, and `cli doctor` names
  the collision so it can be resolved deliberately.

- **Reports showed other sites' rows.** Each report had its own permission, but five
  of the queries behind them never narrowed their rows to the reader's sites: the
  leaderboard, the routine log, routine compliance, the shift-change history, and the
  per-device reliability report. Somebody restricted to one plant could read another
  plant's standings, completions and machines. All five now narrow, and every source
  declares in code which shape it narrows by — the reader's reporting line and site
  for a report about people's work, the site alone for one about machines — so a
  report added later cannot skip it without failing the build. Where a row can be
  traced to work that happened somewhere — a points award to its journal entry — the
  _work's_ site decides it, not the person's: somebody who works at two plants
  contributes their Plant A points to Plant A's leaderboard and their Plant B points
  to Plant B's, rather than their whole total appearing in both.
- **An account with no company, or no group, now says so.** It used to render an
  empty dashboard and 403 from everything, which reads as a broken app rather than an
  unfinished setup.

- **An Admin could not withdraw their own comment while a Manager could.** Moving
  deletion up a tier caught `comments:delete` by accident: withdrawing your own
  remark is not removing somebody else's record (that is `comments:moderate`, which
  stays an administrator's grant). Restored on upgrade.

### Changed

- **The calendar palette is twelve hues in a light and a dark shade**, and light is
  the default. Ordinary shifts should be quiet enough to read for an hour; dark is for
  what must be found at a glance — leave, a public holiday, the one shift somebody is
  scanning for. An earlier build made every cell dark at once, which turned a month
  into a wall of colour where nothing stood out because everything did. Colours
  already chosen keep their look: the bare name is still the light shade.
- **The day-off, leave and public-holiday colours can be set** — on Shifts →
  Calendar colours, from the same palette as the shifts, with each code previewing
  itself. They were hardcoded, which meant the three codes people scan a month for
  hardest were the three nobody could change. Leave defaults to dark red.

- **The schedule grid is readable.** Each day is now a **solid block of its shift's
  colour** rather than a pale pill inside a white cell — a month is read as a pattern
  before it is read as letters. The palette grows from ten colours to eighteen, all
  with dark variants and including **dark red**; the text on each is chosen per hue
  for contrast rather than fixed to white, because white on amber is unreadable. Type
  goes from 10px to 13px, and a **Grid size** control (Compact / Comfortable / Large)
  sits beside the month, remembered per person — a full month still fits across the
  screen at every size.
- **W/O, Leave and Public holiday take their colours from a company setting**
  (`shifts.stateColors`), defaulting to slate, dark red and teal. They were hardcoded,
  which meant the three codes people scan for hardest were the three nobody could
  change. The brush toolbar paints them in the same colours, so the toolbar reads as
  the legend.
- **Every shift is a button in the brush toolbar**, in its own colour, instead of
  hiding behind a "Set shift…" dropdown — the thing a scheduler reaches for all day
  was two clicks away while W/O, L and PH sat in the open beside it.

### Added

- **`cli seed:activity` — demo work across a date range, on your own master data.** A
  restored development copy has the real people, departments and machines but often
  little work to show, so every report opens empty and looks broken. This fills a
  range you name with journal entries and their status trail, scores, points,
  downtime, tasks, routine completions and a published rota — **without touching
  master data**. It prints what each department can and cannot support before writing
  anything, the shape is deliberate rather than uniform (weekday-biased, one bad week
  on one machine, some entries left open), and `--purge` removes exactly what it wrote
  and nothing you typed. Guarded like `restore:dev`: `ALLOW_DEV_SEED=true`, never with
  `NODE_ENV=production`, never against a non-local database.

- **The month roster exports** to Excel or a printable A4 **landscape** page — which
  is also how a PDF is made: open it and print to PDF, rather than carrying a headless
  browser in the server image. Both carry the shift colours and are stamped
  **"Exported 21 Aug 2026 14:32 by <name>"**, because a printed rota is argued with a
  fortnight later and "is this the current one?" is the first question.
- **A shift can say which weekdays it runs.** Coverage only calls a shift uncovered on
  a day it actually runs, so a general shift that is off on Sundays stops being
  reported missing every Sunday for ever — a warning that is always wrong is one
  people learn to ignore, which costs the warnings that are right. Defaults to all
  seven days, so nothing changes until somebody says otherwise.

- **Tags have their own screen, under System.** They were a tab on Journal setup,
  grouped by where the words are used; `tags:manage` is a permission in its own
  right, and holding only that one meant opening a page of four catalogues you may
  not touch to reach the one you own. A separate permission gets a separate place to
  exercise it.

- **Deleting is a superadmin's act, not an administrator's.** Every `* admin` system
  role has lost its `:delete` keys, and each area that can delete gained a
  `* superadmin` tier that holds them. The broad **Admin** role likewise: everything
  except deleting, restoring a backup, and turning on debug logging. An edit leaves a
  history behind; a deletion takes the history with it.
  **This is the one change in this release that takes something away.** Upgrading does
  _not_ promote anyone: grant `<area> superadmin` to the groups that should still be
  able to delete. Nothing else about their access changes.
- **Tasks and downtime are separate roles.** Handing work out and recording an outage
  are different jobs; `Tasks & downtime *` covered both. Groups holding the old role
  come out holding both halves, so no access is lost. New with the split: **Tasks
  editor** — reads and updates, creates nothing — the tier for somebody who works the
  tasks they are given and hands work to nobody. The server already refused them
  anybody else's task; there was simply no role that used it.
- **Reports and analytics are separate roles**, and there is now a viewer per family
  of reports (`Shift reports viewer`, `Cartridge reports viewer`, `Reliability reports
viewer`, …), so a shift lead can hold the rota reports without the cartridge
  figures. `Analytics viewer` is the reliability and downtime charts on their own.
- **`analytics` moved out of the Work permission group** into **Reports & insights**,
  beside reports, the leaderboard and insights — it is a way of looking at work, not
  work.
- **Points & leaderboard viewer no longer carries `departments:read`.** It held it so
  the board's department picker could list departments; seeing your own standing
  should not carry the right to enumerate the organisation. The picker reads
  `/me/departments` instead.

### Added

- **Two-factor authentication can be made compulsory.** Tick it on a **group** —
  "everybody in Admins enrols" — or require it installation-wide, per company, or
  for superadmins specifically, in Settings → Authentication. The sources are ORed:
  a floor, never a ceiling, so nothing waives a requirement somebody else imposed.
  **It is a forced enrolment, not a lockout**: the enrolment screen stays open to a
  blocked person, so the way out is always forward. A **grace period** (default
  seven days, set in Settings) runs from when the requirement first applied _to that
  person_, not from when the switch was flipped — otherwise somebody added to a
  required group months later would be shut out on their first morning. During it the
  app carries a banner counting down; after it, everything but the setup screen is
  refused. Each person is notified when it starts applying to them.

- **A `Viewer` system role** — Member without the filing: every read, no verb at all.
  For an auditor, a visiting manager, or a screen on a wall. It completes the broad
  ladder (Superadmin ⊇ Admin ⊇ Manager ⊇ Member ⊇ Viewer), which is now held in shape
  by a test rather than by memory. The company figures — analytics, insights, the
  leaderboard, the reports — are deliberately not in it: each has a role of its own,
  so handing them out stays a decision.

- **A switch to turn the shipped roles off** (Settings → Access). An
  installation that describes its own access from scratch can stop the fifty system
  roles cluttering every picker: switched off they are not offered, are marked as such
  where a group already holds one, and **stop conferring permissions**. Nothing is
  deleted — every group keeps the roles it holds — so switching them back on restores
  every grant exactly. The panel says how many people would lose all access before you
  flick it, and superadmins are unaffected, so it can always be undone. With them off,
  the Roles list and the group role picker both say so rather than listing permissions
  a role is not granting.

- **A group's effective permissions**, as a tab: the union of its roles, grouped the
  way the role editor groups them, with the role each permission came from on hover.
  Reading four roles side by side to work out whether somebody could delete a device
  was not an answer anybody should have to assemble.
- **Search and a System/Custom toggle in the toolbar** of the Roles, Groups,
  Designations and Users lists — the two filters people reach for constantly, out
  from behind the Filters panel.
- **The role picker shows what is already assigned first**, under a "Selected (n)"
  heading, with the count beside the search box, each role's permission count in
  brackets after its name, and a System / Custom badge. Fifty two-line rows in
  alphabetical order was not a list anybody could scan.

- **`history:read` — a record's own change history, without the audit trail.** The
  History tab was gated on `audit:view`, which is admin-only on purpose: audit rows
  carry before/after snapshots of other people's data. That left somebody working a
  task able to see the task but not what had happened to it. The new key covers the
  change history of a record you may already read, and is granted to every editor
  and admin tier; `audit:view` still opens it too, and the company-wide trail stays
  admin-only. Upgrading grants it to every role that holds `audit:view`, so nobody
  loses a tab they had.

### Fixed

- **A task could be completed with the work never logged, and no way back.**
  "Complete & log work" marked the task done and _then_ opened the journal form;
  anybody who closed that form left a task done, with no record of the work, out
  of the appraisal loop and impossible to log after the fact. Filing the entry is
  now what completes the task — walk away from the form and the task is simply
  still open. A task already closed with nothing against it (including ones closed
  by the old flow) says so and offers **Log the work now**.

### Added

- **Save confirmations, configurable per person.** A brief message in the corner
  when something saves — since a save now keeps you on the page rather than
  redirecting. Whether they appear, which corner, and how long they stay are
  settings under Your account → Preferences; an administrator sets the default.
- **Team routines is a table**, with the same filters, sorting, paging, columns
  and export as every other list — the cards were pretty at a dozen routines and
  unusable at three hundred, and their filters ran in the browser over one unpaged
  request. Filter by title, department, cadence, status, points, **who does it**
  (your downline) and **the site its people work at** — a routine belongs to a
  department, and departments span sites, so that last one is the question a
  manager actually asks. The unpaged `?scope=managed` list it replaces is gone.
- **Paging controls above every table as well as below**, so a full page of rows
  does not have to be scrolled to reach "next".
- **A permission per report.** `reports:view` granted every report at once —
  including every report added afterwards. Each of the seventeen now has its own
  key (`reports:view:downtime`, `reports:view:part_register`, …), so a shift lead
  can hold the rota reports without the cartridge figures. Viewing includes
  printing and exporting: whoever may read the rows may take a copy. There is no
  umbrella key, so a new report starts granted to nobody — and adding one will not
  compile until it has a key of its own. **Upgrading takes nothing away:** the
  migration gives every role that could read reports yesterday all seventeen keys,
  then retires the two old ones. Nothing outside the permission tables is touched.
- **`cli restore:dev` — work on a copy of production without endangering anybody.**
  Loads a backup into a development database and makes it safe in the same run:
  every local password becomes the development one, two-factor and sessions go,
  emails keep their name but move to `@dev.local`, phone numbers and provider
  secrets are erased, and every notification channel but the in-app bell is
  switched off. The journal, routines, rotas, assets and points survive, because
  that is the point of the copy. Refuses to run unless `ALLOW_DEV_RESTORE=true`,
  `NODE_ENV` is not production, the database is local, and a confirmation phrase
  is typed. The log database is restored only when asked for.
- **Every long list is now a dropdown you can type into.** Assigning a task or a
  routine, handing an entry over, choosing a device, a model, a site or a
  department: each opens a searchable list rather than a native select you had to
  scroll, and each option carries a second line — a person's department, a
  department's parents — so two of the same name are finally tellable apart. The
  controls work from the keyboard throughout (↓ opens, arrows move, Enter chooses,
  Esc closes; in a multi-select Enter toggles and the list stays open), and they
  take the field's id so a label points at something. Short fixed lists —
  priority, cadence, status — stay as they were.
- **A rota belongs to a site, not just a department.** A department spans several
  plants whose teams never share a building, but a schedule was one calendar for
  all of them — and a colleague swap could be offered between two sites fifty
  miles apart. Schedules are now per department **per site**: the roster is the
  people that site's memberships cover, coverage warnings are per site, and swaps
  stay within one rota unless an approver deliberately allows a cross-site trade
  and says why.
- **A central rota for travelling staff.** People who work a general shift and go
  where they are needed are marked **Central** on the department's Members tab and
  rostered on their own rota, managed by the Head of Department. Each day there
  can name the site or sites it involved — an indication for whoever reads the
  rota, with no hours or half-days recorded, because that is what was asked for
  and nothing computes from it.
- Rotas that predate sites keep working: each is attached to its department's site
  where there is only one, and otherwise stays on the central rota, where the
  people already rostered on it continue to appear.

### Security

- **Reports showed one site's figures to another.** Of seventeen report sources
  only the journal and downtime narrowed their rows to the reader's sites;
  reliability rolled up every root asset in the company — and an asset tree can
  cross sites, so a subtree total mixed plants — while the seven cartridge reports
  read every part. Every report now applies the rule the journal already used:
  **(the reader plus their downline) AND company AND location**, and naming an
  asset id outside your sites answers "not found" rather than its figures. A
  static guard fails the build if a report reads location-bearing rows without
  consulting the caller.
- **`ALLOW_INSECURE_HTTP=false` turned insecure HTTP on.** The three boolean
  environment flags were coerced with `Boolean(value)`, and every non-empty string
  is truthy — so writing the safe value explicitly produced the dangerous one,
  while the startup check reported it as on and the file said false. It did not
  need anybody to be explicit either: the shipped `compose.prod.yaml` passes
  `${ALLOW_INSECURE_HTTP:-false}`, so **every production install has had insecure
  HTTP permitted and session cookies without the `Secure` flag** — with no value an
  operator could write to turn it off. `ALLOW_REGISTRATION` is not passed by
  compose, so open sign-up needed somebody to write it. Flags are now
  read as `true/false`, `1/0`, `yes/no` or `on/off`, and anything else refuses to
  boot rather than guessing.
- **A failed backup could publish the database password.** `pg_dump` was given the
  whole connection URL, so a password containing an unescaped `@` made it resolve
  the wrong host and quote the mangled string back — and that message was stored
  on the backup row, shown in the UI, sent as a failure notification by email, and
  logged. The credential no longer reaches the command line at all (connection by
  flags, password in the child's environment, forwarded rather than printed
  through a `docker exec` wrapper), and every captured message is scrubbed of URL
  user info, known passwords and `PGPASSWORD=` echoes before it is stored, logged
  or sent. Applies to restores too. **If you have seen a failed backup, rotate the
  database password and clear `backups.error`** — the value was at rest in three
  places.

### Added

- **Every backup attempt keeps its own log, and failures say why in the row.** The
  reason a backup failed was a tooltip on a badge — unreachable on a touchscreen,
  and invisible on a screen nobody was hovering over. It is now printed in the row,
  and each attempt (successful or not) carries a downloadable transcript: when it
  ran, what ran, how it ended, and the tool's own output, redacted of anything
  credential-shaped. Kept with the attempt rather than in the log database, which
  is switchable and pruned.
- **A failed backup now tells whoever asked for it.** Notifications skip the person
  who caused the event — right for "Priya assigned you a task", wrong for a
  failure. On an installation with one operator it meant a manual backup could fail
  and notify nobody at all.

### Fixed

- **Filing a journal entry required permission to administer departments.** The
  entry form asked `/users/:id/departments` and `/locations` for its pickers, both
  gated on administrative read permissions — so somebody holding `journal:create`
  was told "You are not in a department yet" with the site reading "Not set" and
  the category picker disabled behind it, while their placement was perfectly
  correct. Forms now ask `GET /me/departments` and `GET /me/locations`, which need
  only a session: a person's own placement is already in it. The shift-change
  request and the routine editor had the same flaw.
- **Saving an edit no longer throws you back to the index.** An edit stays on the
  page and confirms; creating opens what was just made; deleting still returns to
  the list, because what you were looking at is gone.
- **"All companies" left ordinary users with an empty app.** Permissions are
  resolved per company, so that state grants none at all — an empty sidebar and a
  refusal from every screen, indistinguishable from having had access revoked. It
  only ever made sense for a superadmin, who holds everything regardless, so
  nobody else is offered it and anybody landing there is put into their own
  company.
- **`cli backup:database` hung for ever when a backup failed.** Notifying opens a
  queue connection and the command closed only its database pools, so the one path
  a nightly cron most needs to finish — the failing one — never exited.
- **`cli doctor` now proves the backup tools can connect**, not merely that they
  exist and are new enough. A wrong password or an unreachable host used to be
  discovered by a backup failing at 2am.

- **Department pickers said which department, never which company.** A name is
  unique within a company but not across them, so anybody belonging to a
  "Maintenance" at two companies was offered the same word twice with nothing to
  choose by — and picking the wrong one failed on save. Forms that create
  something now offer only the active company's departments, every department
  shows its parents on a second line, and the one list that spans companies (a
  person's own Departments tab) names the company on each membership. The lists
  are searchable, and `path` now travels with departments from the API instead of
  being re-derived — twice, wrongly — in the client.

## [0.4.0] — 2026-08-13

First public release.

### The journal

Teams file what happened — an issue found, work done, a machine down. Entries
carry the asset, the site, a category and the department's own tags, with
attachments, a conversation that stays open after the record locks, and handover
when a shift ends with something unfinished. Work time and downtime are recorded
separately, because a person's engagement and a stopped line are different
numbers, and whether a thing can stop production at all is a property of its
type.

### Scoring, and the people doing the work

An entry is scored by its author and again by a reviewer, who may override in
either direction. Points feed a leaderboard scoped to your own reporting line,
and every change is on the record with who made it.

### Recurring work

Shifts with a per-department calendar and colleague swaps that route to the right
approver. Routines — the weekly check, the monthly clean — with compliance
tracking and month-end awards.

### The figures

Saved report views over the journal, printable and exportable. Reliability
analytics with MTBF, MTTR and availability rolled up through the asset tree.
Insights charts for the shape of the work, each readable as a table.

### Assets, devices, and an optional module

Assets and devices in a tree — site, line, station — picked a level at a time,
with bulk import and export for every master list. Cartridges is the first
optional module: refillable parts, their service history and tours of duty, with
points taken back when one comes straight back faulty. Off by default and
switchable per company.

### Access, and telling people things

Groups hold roles and the companies and locations those roles apply to; a new
user has no access until they are added to one. Notifications reach people
through six channels, with an administrator's matrix that is both the default and
the ceiling.

### Running it

Scheduled database and file backups with retention and a restore path. An
append-only audit trail. Structured JSON logs in their own database with
per-feature levels. TOTP two-factor and OIDC single sign-on. Queue administration
behind a server switch. `cli doctor` checks every dependency and exits non-zero,
so a deploy can gate on it.

[0.4.0]: https://github.com/brijeshdave/reportly/releases/tag/v0.4.0
