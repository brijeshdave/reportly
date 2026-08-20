# Changelog

All notable changes to Reportly are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
