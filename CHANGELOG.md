# Changelog

All notable changes to Reportly are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

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
