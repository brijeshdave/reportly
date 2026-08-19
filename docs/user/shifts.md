# Shifts and schedules

Who is on which shift, on which day, for a department. Built once by whoever
runs the roster, then changed by the people working it.

---

## The three pieces

|                  | What it is                                                               |
| ---------------- | ------------------------------------------------------------------------ |
| **Shifts**       | The catalogue — Morning, Afternoon, Night, and what hours each means     |
| **Schedule**     | A rota: one cell per person per day, for one department at one site      |
| **Shift change** | A request to change your own cell, decided by someone with the authority |

The catalogue is defined once. A rota is built **per department, per site, per
month** — see below.

---

## A rota belongs to a site

A department usually spans more than one site, and those teams do not work in the
same building. So each has its own rota: pick the department **and** the site at
the top of the Schedule page.

What follows from that:

- **Who is on it.** The people whose membership covers that site. Somebody placed
  at no site in particular counts as being at all of them, so they appear on every
  site's rota — the same meaning "no sites" has everywhere else in Reportly.
- **Swaps stay within it.** A colleague swap is offered only between people on the
  same rota, because a swap between two plants is not usually a swap at all. A
  manager can still allow one deliberately — see below.
- **Coverage is per site.** "Nobody on Night on the 14th" now means nobody at
  _that_ site, which is the question worth asking.

### Travelling staff and the central rota

Some people are not at a site: they work a general shift and go where they are
needed — a full day at one plant, or one plant in the morning and another after
lunch.

Tick **Central** against them — on the department's **Members** tab, or on
**Users → _the person_ → Departments**, whichever you are nearer. They are then
rostered on the department's **central rota**, chosen from the same site picker,
and they appear on no site's rota — they are scheduled once, in one place.

On the central rota each day can say **where** it was spent: pick one site or two
in the **Where** box when setting the days. The cell shows the initials, with the
full names on hover.

This is a note for whoever reads the rota, not a timesheet. Reportly does not
record hours, halves of days, or which plant came first — only that the day
involved those sites.

**The central rota is managed by the department's Head of Department.**

> **To see who is visiting a plant on a given day, read the central rota** — a
> site's rota shows only its own people. Travelling staff do not appear as
> visiting cover on it.

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

1. Open **Schedule** and pick the department, the site, and the month. Both lists
   are searchable, and the department one shows each department's parents
   underneath its name. Choose **Central (travelling staff)** for the rota of
   people who move between sites.
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

### Swapping across two sites

The candidate list is the people on the same rota, and normally that is the whole
answer. Colleagues on the department's **other** sites are listed too, marked with
where they are — because occasionally somebody genuinely does cover both.

Choosing one of those is refused unless you confirm it and **say why**. The reason
is kept with the request: somebody reading the rota next month can see why two
plants traded a shift.

Central staff cannot be swapped with a site's rota at all. They are scheduled
centrally; changing their day is an edit to the central rota, not a swap.

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
