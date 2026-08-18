# Shifts and schedules

Who is on which shift, on which day, for a department. Built once by whoever
runs the roster, then changed by the people working it.

---

## The three pieces

|                  | What it is                                                               |
| ---------------- | ------------------------------------------------------------------------ |
| **Shifts**       | The catalogue — Morning, Afternoon, Night, and what hours each means     |
| **Schedule**     | A department's calendar: one cell per person per day                     |
| **Shift change** | A request to change your own cell, decided by someone with the authority |

The catalogue is defined once. The schedule is built per department, per month.

---

## Reading the calendar

Each row is a person, each column a day, each cell what they are doing:

- A **shift name** — they are working it
- **W/O** — weekly off
- **PH** — public holiday
- **Leave**

Cells are coloured by shift so a pattern is visible at a glance rather than read
one cell at a time. A cell that has been **changed since the schedule was
published** is marked, so you can see what moved without comparing to a
printout.

The calendar has two views. **Plan** is what was published. **Actual** is what
happened after approved swaps. They differ exactly where a change was approved,
which is the point — the plan stays as a record of what was intended.

---

## Building a schedule

You need `shifts:manage` (the **Shifts admin** role).

1. Open **Schedule** and pick the department and month. The department list is
   searchable and shows each department's parents underneath its name.
2. Fill cells. You can drag across several days to set them in one go, and fill
   a whole weekday down the column — most rosters are a repeating pattern with
   exceptions, so set the pattern and then fix the exceptions.
3. **Publish** when it is ready. Until then it is a draft nobody else acts on.

**Locking.** A published schedule can be locked, which freezes it against direct
edits while still allowing approved swaps through. Use it when the roster is
agreed and you want changes to go through the request flow rather than someone
quietly editing a cell.

**Carry-forward.** A new month can start from the previous one rather than
empty, which is usually most of the work.

**Coverage.** The schedule shows where a day is short — a shift with nobody on
it, or fewer people than it needs. Fix the gaps before publishing; that is what
the view is for.

---

## Asking to change your shift

You can change **your own** cell, and only a working shift or a weekly off.
Leave and public holidays are not swappable.

1. Open **Shift change**.
2. Pick the day you want to change.
3. Optionally suggest a colleague to swap with — it must be someone working that
   same day. You can leave it open and let the approver choose.
4. Add a reason. It is optional, and it is the thing that gets your request
   approved, so write one.

One open request per shift. If you already have one pending for that day, deal
with it before raising another.

**Withdrawing.** A pending request can be withdrawn by the person who raised it.
Once it has been decided it is part of the record.

---

## Approving a change

You need to be the requester's **reporting manager**, or hold `shifts:approve`
(the **Shifts editor** role) or `shifts:manage`.

Approving is deliberately separate from building the schedule. A supervisor
covering the floor can decide swaps without being given the roster to edit.

The inbox shows what you can act on. For each request you see who asked, which
day, what they are working, and a list of colleagues who could take it. If the
requester suggested someone you can accept that or pick differently — the
decision is yours, not theirs.

- **Approve** — the two cells trade. The Actual view moves; the published plan
  stays as it was.
- **Approve with no swap** — the requester comes off that shift and nobody takes
  it. This leaves a gap, deliberately and visibly, rather than pretending the
  shift is covered.
- **Reject** — the request is closed with your decision on the record.

Every decision is recorded with who made it and when. **Handled** shows the ones
you have decided.

---

## What it feeds

Four reports, under **Reports**:

- **Shift roster** — who is on what, over a range
- **Shift change history** — every edit and approved swap, with from → to
- **Shift coverage & gaps** — where a day is short
- **Shift attendance** — scheduled against what happened

---

## Common questions

**Someone left the department mid-month.** Their cells stay on the published
schedule as a record. Remove them from future months.

**I need to change somebody else's shift.** That is a schedule edit, not a shift
change — it needs `shifts:manage`. The request flow is for changing your own.

**A swap was approved but the calendar looks unchanged.** You are on the Plan
view. Switch to Actual.

**Nobody can approve my request.** Your reporting line is probably not set — the
inbox routes to your reporting manager. Ask an administrator to check who you
report to under People.
