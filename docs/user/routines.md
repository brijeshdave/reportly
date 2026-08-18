# Routines

The work that comes round again — the weekly filter check, the monthly
calibration, the daily walk. Defined once, and then it appears when it is due.

A routine is not a task. A task is a one-off somebody handed you; a routine
recurs on its own and keeps a compliance record over time.

---

## My routines

What is assigned to you, led by the routine itself and then its schedule — so
you read "the filter check, weekly, due Friday" rather than a wall of dates.

Each occurrence is one instance: this week's filter check. You **log** it when
you have done it.

### Logging one

Open the occurrence and record it. You can set the times it actually started and
finished rather than accepting "now" — you did the job at 6am and are typing it
up at 9, and the record should say 6.

**Re-logging.** If you got it wrong, log it again; the correction replaces the
entry and the change is on the record.

### Grace, and expiry

An occurrence has a window: due, then a **grace period**, then it expires. An
expired occurrence counts as missed and cannot be logged — which is what makes
the compliance figure mean something. If everything could be logged forever,
"98% compliant" would only say people eventually got round to it.

The grace period is set per routine. If yours is too short for how the work
actually happens, that is a conversation with whoever defined it, not something
to work around.

---

## Team routines

Needs `routines:read`. Shows every routine in your scope and how they are
tracking, with filters and sorting so a long list is usable.

The **compliance grid** is one row per routine, one column per period: done, due,
missed. It answers "what is slipping" without opening anything.

---

## Defining a routine

Needs `routines:manage` (the **Routines admin** role).

A routine carries:

- **Title and description** — what to do, specifically enough that someone who
  has not done it before can
- **Department** — who it belongs to, and where its points are credited on the
  leaderboard. You are offered your own departments in the company picked in the
  top bar; each is listed with its parent departments underneath, and you can
  type to search. (If you work for two companies, the other one's departments are
  not offered here — switch company in the top bar first.)
- **Schedule** — how often it comes round
- **Grace days** — how long after it is due it can still be logged
- **Assignees** — who owes it

Change a routine and the change applies to occurrences from then on. Ones
already logged stay as they were logged; a routine's history is a record of what
was done, not of what the current definition says should have been.

---

## Points

Routines award points at **month end**, credited on the 2nd of the following
month, so a month's compliance is complete before it is scored.

This is separate from journal scoring. Journal points are for what you recorded
and how it was reviewed; routine points are for turning up to the recurring work.
Both land in the same ledger and the same leaderboard.

If the award did not run — the server was down on the 2nd — it catches up on the
next boot rather than skipping the month.

---

## What it feeds

Two reports, under **Reports**:

- **Routine log** — what was logged, by whom, when
- **Routine compliance** — per person: due, completed, missed, and the on-time
  rate

---

## Common questions

**A routine stopped appearing.** Either it was retired, or you are no longer an
assignee. Check Team routines.

**I did the work but the occurrence expired.** It cannot be logged — that is
deliberate. Tell whoever runs the routine; they can see the miss and its reason
matters more than the tick.

**Can I log a routine for somebody else?** No. An occurrence belongs to the
person it was assigned to, and a compliance record that anyone can fill in on
anyone's behalf is not a record.

**Why did no points arrive?** They land on the 2nd for the month before. Before
that date, the month is not finished.
