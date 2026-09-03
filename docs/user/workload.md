# Workload reports

Three reports that answer one question from three sides: **who in my department did
how much, over a period.**

- **Department workload** — one row per person, with a column per kind of work.
- **Department workload by day** — a grid: one row per person, one column per day.
- **Irregularity** — the people who did little or nothing.

They share a filter set, a grouping and a sort, because they are three views of one
query. A window you set on one means the same thing on the next.

Find them on the **Reports** page under the **Workload** tab, ready to run or to
clone; or build one from scratch with **New report** and pick them under
**Report on**.

---

## What each column counts

The columns are the whole report, and a wrong attribution is invisible in the
output — a job counted twice looks exactly like a busy month. So, precisely:

| Column           | One unit is                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| **Issues**       | A breakdown they **filed**, by its report date.                          |
| **Planned work** | A planned-work entry they filed, same rule.                              |
| **Tasks**        | A task **completed** in the window, counted for everybody who was on it. |
| **Cartridges**   | A cartridge they installed, took out, or serviced.                       |
| **Routines**     | A routine occurrence they completed, counted on the day it was **due**.  |
| **Points**       | Points credited to them by a review.                                     |
| **Total**        | The activity columns added together.                                     |

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
