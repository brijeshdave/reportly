# Workload reports

Six reports that answer one question from six sides: **who in my department did
how much, over a period.**

- **Department workload** — one row per person, with a column per kind of work.
- **Department workload by day** — a grid: one row per person, one column per day.
- **Workload by severity** — a grid: one row per person, one column per severity.
- **Workload by category** — a grid: one row per person, one column per category.
- **Irregularity** — the people who did little or nothing.
- **Gone quiet** — the people who have logged nothing at all, and for how long.

They share a filter set, a grouping and a sort, because they are three views of one
query. A window you set on one means the same thing on the next.

Find them on the **Reports** page under the **Workload** tab, ready to run or to
clone; or build one from scratch with **New report** and pick them under
**Report on**.

---

## What each column counts

The columns are the whole report, and a wrong attribution is invisible in the
output — a job counted twice looks exactly like a busy month. So, precisely:

| Column              | One unit is                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| **Issues**          | A breakdown they **filed**, by its report date.                          |
| **Planned work**    | A work entry they filed **with no task behind it** — see below.          |
| **Tasks**           | A task **completed** in the window, counted for everybody who was on it. |
| **Fitted**          | A cartridge they installed.                                              |
| **Removed**         | A cartridge they took out.                                               |
| **Serviced**        | A cartridge they serviced.                                               |
| **Routines**        | A routine occurrence they completed, counted on the day it was **due**.  |
| **Tasks not done**  | A task due in the window, assigned to them, still not done.              |
| **Routines missed** | A routine occurrence due in the window that nobody completed.            |
| **Points**          | Points credited to them by a review.                                     |
| **Total**           | The activity columns added together.                                     |

Those three used to be one **Cartridges** column with all of them added together,
which meant "how many did this person refill" and "how many did they service" had
the same answer. They are counted apart now, and **Total** still adds all three.

**Planned work and Tasks are not the same jobs counted twice.** Completing a task
opens a journal entry, so every completed task used to appear in both columns and
inflate the total. A work entry filed **against a task** now counts only under
_Tasks_. What is left in _Planned work_ is a work entry standing on its own —
routine daily work somebody logged directly, with no task behind it.

**What was due and not done is reported beside the total, never inside it.** _Tasks
not done_ and _Routines missed_ are not activity: a total that grew when somebody
missed something would make failure look like work. A missed routine is worked out
from the routine's own schedule, since a miss leaves no record — only days that have
**passed** count, so an occurrence due today is pending rather than missed. A
**cancelled** task is not a miss either: calling work off is a decision somebody
made.

Three of those are worth spelling out.

**Entries count for their author.** Being named on somebody else's entry is how the
points get divided; it is not who did the filing.

**A handed-over task counts for both people.** If a job passed from one person to
another mid-shift, both did part of it, and both get the one. That is the same rule
the points follow — a report that credited only whoever happened to finish would
quietly erase the first person's shift.

**Points are shown but never added into Total.** A count of jobs and a number of
points are different units; a total mixing them would be a number that means
nothing. Only _direct_ points count here — a manager's share of what their team
earned is theirs on the leaderboard, not activity of their own.

---

## By severity, and by category

The flat report says how _much_ somebody did. These two say what it **was** — ten
Critical breakdowns and ten Informational ones are the same number and a very
different month.

| Person       | Working days | Informational | Minor | Moderate | Major | Critical | Planned work | Total |
| ------------ | ------------ | ------------- | ----- | -------- | ----- | -------- | ------------ | ----- |
| Anil Fitter  | 4 / 4        | 0             | 2     | 1        | 0     | 0        | 6            | 9     |
| Sam Operator | 2 / 4        | 1             | 0     | 0        | 1     | 2        | 3            | 7     |

The columns come from your own configuration — whatever your severities and
categories are called — and the severity columns are in the ladder's own order, so
reading left to right is the work getting more serious.

### Work that has no severity

**Planned work** is its own column on the severity report, and it matters more than
it looks. Completing a **task** opens a journal entry, and that entry is always a
work log — which has no severity, because "nothing broke here, this is what I did"
has nothing to rate. Without this column, somebody who wrote up thirty tasks and
raised two breakdowns would read as **2** on this report.

**Routines are not here at all**, and should not be: a routine completion is its own
record and never becomes a journal entry. Use the routine compliance reports for
those.

### Not set

**Not set** means an **issue** that is missing a severity. Since a submitted issue
must name one, that can now only be an entry filed before that rule existed — which
is exactly the kind of record worth going back and fixing.

The column is drawn **only when something is in it**. Once the old entries are tidied
up it disappears, rather than sitting there as a column of zeros for ever.

The **category** report has no Planned work column, because a category fits a work
log as well as an issue — "what kind of thing was this" is a fair question about any
job — and its own Not set follows the same rule.

---

## The grid, day by day

**Department workload by day** is a timesheet, not a list:

| Person       | Working days | Mon 31 | Tue 01 | Wed 02 | Thu 03 | …   | Total |
| ------------ | ------------ | ------ | ------ | ------ | ------ | --- | ----- |
| Anil Fitter  | 4 / 4        | —      | 0      | 2      | 1      |     | 3     |
| Sam Operator | 2 / 4        | —      | —      | 4      | 0      |     | 4     |

**One row per person, whatever they did**, and one column for every day of the
period — a week gives seven columns, a month gives thirty-one, three days give
three. The date range decides; nothing needs setting up.

Each cell is what that person did that day, counted the same way as the summary.
**A dash means they were not on the rota** — so a day off reads differently from a
day they were in and did nothing, which is the whole point of the distinction. Work
logged on a day off still shows its number: that happened, and hiding it would be
the bigger lie.

A month of columns is wide; the table scrolls sideways, and Excel export keeps the
same shape.

---

## Working days

**Working days reads `18 / 24`.**

The first number is the days that person was rostered **working** in the period.
Days off, leave and public holidays are on the rota and none of them is a working
day, so none of them counts — which is the point of the column.

The second is the **highest anybody in the same group was rostered** over the same
period. It is what makes the activity counts comparable: somebody at 18 of a
possible 24 was simply available less than the person beside them, and a count of
work read without that is a judgement about attendance dressed up as one about
effort.

Change the grouping and the denominator changes with it, because the comparison is
always against the people the row is being read next to.

If nobody in the group is on a rota at all, the cell shows a bare count rather than
`0 / 0`.

---

## Grouping

**None**, **by site**, **by designation**, or **by department**.

Site and department are both many-per-person, and nobody may be counted twice
without the totals becoming nonsense. So somebody who works across several sites
lands in **Several sites** rather than appearing under each — a real answer, since
their work is not attributable to one plant. The same for **Several departments**,
and **No site** / **No designation** for people who have none.

---

## Irregularity

Every row carries the raw total, the rate, and the bar it is being judged against:

| Column              | Meaning                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Working days**    | As above.                                                                                                       |
| **Total**           | Pieces of work in the period.                                                                                   |
| **Per working day** | Total ÷ rostered days — the only fair comparison between somebody who worked 6 days and somebody who worked 24. |
| **Group average**   | The same figure for their group, so the bar is on the row instead of implied.                                   |
| **Below**           | How far under the group average they are.                                                                       |

**List people below** is a number you set, and it defaults to **1** — so the report
opens on the people who did _nothing at all_. Raise it to 5 for a stricter look.

**Somebody with no rota reads `—`, not `0.00`.** Dividing by no working days is not
a performance figure, and printing one invites a conversation about a number that
measures nothing. They sort to the top all the same: being on no rota is its own
kind of irregular, and usually the thing actually worth fixing.

---

## Who can see what

Every row is somebody's work, so these narrow the way the journal does: **you
account for yourself and the people below you in the reporting line**, within your
company and your sites. A head of department sees their nested organisation; a
person with nobody under them sees one row.

Each report has its own permission:

| Report                     | Permission                         |
| -------------------------- | ---------------------------------- |
| Department workload        | `reports:view:dept_workload`       |
| Department workload by day | `reports:view:dept_workload_daily` |
| Irregularity               | `reports:view:dept_irregularity`   |

The **Workload reports viewer** role holds all three, and the roles that already
read every report pick them up too. Holding the permission does not widen the
reporting line — it decides whether the report opens, not whose work is in it.

---

## Ranges and export

The named ranges (this month, last month, and so on) work as they do everywhere.
A custom range may span a year for the summary and irregularity reports, and a
month for the grid — past that the columns stop fitting on any page.

Both export to Excel and to a printable page like every other report, and both can
be saved as a view and shared.

---

## Gone quiet

**Irregularity** asks "who did less than N in this period". **Gone quiet** asks a
different question: "who has logged nothing at all, and since when".

They catch different people. Somebody who filed forty entries on the 1st and nothing
since looks busy to the irregularity report — their total for the month is fine — and
is exactly who this one is for.

| Person       | Last entry | Last task | Last routine | Last cartridge | Last of anything | Days quiet |
| ------------ | ---------- | --------- | ------------ | -------------- | ---------------- | ---------- |
| Anil Fitter  | never      | never     | never        | never          | never            | never      |
| Sam Operator | 12 Sep     | 28 Aug    | never        | 12 Sep         | 12 Sep           | 16         |

Longest silence first, and **never** above all of it — somebody who has never logged
anything is not the same as somebody with a long gap, and the top of this report is
the point of reading it.

### Two settings

**Days quiet** — how long a gap has to be before somebody is listed. Seven by
default: a working week with nothing in it is the first thing worth a second look,
and anything shorter catches everybody who was on leave.

**What counts as logging something** — leave it on everything to ask "who has gone
completely quiet", or pick one kind to ask a narrower question. That is what makes it
usable per kind, as asked: somebody doing their routines and filing no journal entries
is a different problem from somebody doing nothing, and a report counting any
activity at all hides them.

> This report reads the **whole history** to find each person's last activity, not
> just the window you picked. A date range that ended last month would otherwise
> report everybody as silent since then, which is true and useless.
