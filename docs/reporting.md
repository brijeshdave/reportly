# The Journal — logging and scoring work

This page explains, in plain terms, how the **Journal** works for everyone who uses
Reportly — the person filing entries, and the manager scoring them. The Journal is the
daily record of issues and work; "report" is reserved for the generated reports built
on top of this data. It is not about the code.

## The idea in one paragraph

Everyone logs their issues and work as **journal entries**. When an entry is finished, it
is **scored in points**: the person who did the work splits the credit among everyone who worked it
(the **self** split), and their reporting manager gives a **review** — their own points
for the same people. The review is what officially counts; the self split stands until
then. You see your own split, but **not** the manager's review of you. A share of a
worker's points rolls up to the managers above them, because your team's work is partly
yours. Every figure is in half-point steps.

## Filing a report

A report cannot be scored until it is finished. Points are for work that was done,
and a report still in progress has not finished being done — so move it to
**Resolved** (or close it another way) before anyone scores it.

**Reports → New report.** Pick a **kind**:

- **Issue / breakdown** — something went wrong. You give it a severity, describe what
  happened, the root cause, and what will stop it happening again, and set a status.
  **A breakdown cannot be submitted without a severity** — the severity is what sets
  the points ceiling, so one filed without it would be scored against a fallback
  nobody chose. A draft may still be incomplete; that is what a draft is for.
  **The work fields start closed**: raising a breakdown and fixing it are two moments,
  and the fix usually happens afterwards — sometimes by whoever reads it on the next
  shift. Tick **"I already did the work"** when it is genuinely one job, and they open.
- **Work log** — routine daily work. Just what you did. No severity, no status — so
  there is no severity to require, either.

Fill in what fits, then either:

- **Save draft** — keeps it private to you, to finish later. Nobody else can see a
  draft.
- **Submit** — sends it up the line, where your managers see it and can score it.

Only the **title** is required to save. Everything else is there when it helps.

### Logging the work afterwards

Open the entry and use **Log work**. Each piece of work is its own item, with **who
did it and when** — start and finish times, both optional but worth filling in. A job
worked over two shifts by three people reads as what it was:

> 08:40 – 09:10 Ravi — Isolated the drive
> 11:15 Mo — Fitted the replacement belt

**Colleagues log their own.** Anybody on **who worked on it** can add an item, and it
belongs to them: you can correct your own, and nobody can rewrite yours. Adding
somebody to _who worked on it_ is also what lets them open the entry at all.

The entry's own work summary follows the newest item, so the reports and exports carry
on reading one line.

**A closed entry will not take new work**, and neither will a locked one. That is deliberate and separate from the
appraisal lock, which comes later: a finished record that still accepts "what was
done" is one that can be rewritten after everyone has stopped looking. **Re-open** it
if there is more to say — that move is recorded, which is the point of making it the
way back. Everything else about a closed entry stays editable; this is a rule about
the work record, not a freeze.

## What the report is about

Under **What is it about?** you can point the report at anything it concerns:

- **Assets** — the structural things: a plant, a line, a station. Picked from a short
  list.
- **Devices** — the individual machines. **Searched**, not browsed, because there may
  be thousands of them.
- **Departments** and **People** — when the report concerns those instead.

Pick as many as apply, in any mix — **or none at all**. Plenty of work is not about
any particular thing, and a report with nothing picked is a complete report.

> **Why devices are searched, not browsed.** Nobody is going to file ten thousand
> machines into a tree by hand. Instead each device records the asset it **lives at**,
> so asking for "the issues on Line 3" still finds the robot standing at its station —
> without that robot ever having been placed in a tree.

## Attaching files

The **Files** panel on a report takes the photo of the seized belt, the vendor's PDF,
the trace you exported. Pick a file and it uploads; the panel says the size limit and
what types are accepted, and the file chooser only offers those.

A few things worth knowing:

- **Files follow the report's lock.** Once a report has been scored it is locked, and
  that includes its files — they are part of what was appraised. **Re-open** it to add
  or remove one. (Downtime is different: a line that is still down has to be closable
  afterwards.)
- **A file is exactly as private as its report.** If someone cannot see the report,
  they cannot see, download, or even know about its files.
- **Deleting a report deletes its files** — properly, including the stored copies.

## Downtime — the other clock

**Work time** (the Started/Ended times on a report) is how long _you_ spent.
**Downtime** is how long the _equipment_ was out of service. They are different
numbers, and adding them together makes both meaningless — so downtime is recorded
separately, on the report's **Downtime** panel.

- Pick one of the assets or devices the report is about, and say when it went down.
- **Leave "back up" empty if it is still down.** The entry stays **open** and waits
  in **Downtime → Still down** until somebody closes it.
- To close it, open the report and fill the end time in. That is the whole loop.

**Downtime → Totals** adds it all up per thing, worst first. An outage that is still
open counts up to _now_ rather than reading as zero — a breakdown nobody has closed
should be uncomfortable to look at.

## Tasks — work you were asked to do

**Tasks** is the other half of reporting: a report is the record of work done, a task
is the _request_ for work to be done.

- **Someone assigns you a task** — a title, what needs doing, a priority, maybe a due
  date. It appears under **Tasks**, which opens on open work, soonest deadline first.
- **You can assign one too** — to yourself, or to anyone below you in the reporting
  line. The picker only offers those people, because those are the only ones the
  server will accept. Pick **several** if the job needs more than one person, or
  **none at all** to plan the work now and hand it out later — an unassigned task
  stays on your own list and notifies nobody until somebody is put on it.
- **Start work** marks it in progress, so your manager can see it has been picked up.
- **Complete & log work** is the important one. It marks the task done _and_ opens a
  work report already filled in from it — the title and the brief are carried across.
  Edit it into what you actually did and submit.

That last step is the whole point: finishing a job and recording it are one action, so
the work reaches the appraisal loop instead of ending at a tick-box. The report and the
task stay linked — the task shows the report filed against it, and the report says which
task it came from.

**What a task is worth.** Every task carries a **points** number — what the whole
job earns, split between whoever does it. Whoever raises the task sets it, and
**only a manager can change it afterwards**, so nobody decides what their own work
is worth. A manager assigning work sets it as they assign, and can regrade any open
task from its page with **Change**.

One installation-wide ceiling (Settings → Tasks → Points, default **100**) bounds
every task. A task worth more than that is refused rather than quietly trimmed.

**That number is the ceiling of the entry filed against it** — not the entry's
severity. Severity grades a breakdown by how bad it was, which says nothing about
how much work a planned job took; a rebuild worth eighty and a form worth two are
both real. The author splits the task's points between the people who did it and
their manager confirms, exactly as for any other entry.

**Reopening a task takes its points back.** If a manager sends a finished task back
to work, the entry filed against it stays — it is the record of what was done — but
its scores and its ledger rows are cleared, and it earns again only when the job is
finished and scored again.

**Handing a task over.** Long jobs outlast shifts. When that happens the person
holding it tells their manager, and the manager uses **Hand over** on the task page,
naming who picks it up and why. The outgoing person is not removed: the task page
shows them struck through, they keep access to it, and the entry that finally
records the work arrives with everybody who worked on it already on it — so the
author divides the points across all of them. Re-assigning through **Edit** is a
different act: it says the job was always somebody else's and leaves nobody behind.

Tasks carry files too, exactly like reports.

> Only the people a task was **given to** can complete it or log work against it —
> including anybody who handed it over part-way through. Only the person who **handed
> it out** (or someone above them) can re-assign it, rewrite it, or hand it over.
> To call work off, **cancel** the task rather than delete it — cancelling is a record
> that it was called off; deleting is an administrator's action and pretends it never
> existed. Deleting a task never removes the reports filed against it.

## Statuses — where a report has got to

An **issue** carries a **status**, and it is the field people touch most. Change it
from the top of the report itself — pick a new one and press **Save** — there is no
need to open the edit form. (Saving is deliberate: a status move is a real event on
the timeline, so it does not fire the instant you touch the dropdown.)

A **work log** has no status workflow — it is a record of work already done, so it
just shows a **Done** badge. The states below are for issues.

**The four working states:**

| Status           | Use it when                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**         | Filed, and nobody has picked it up yet. Every report starts here — there is no such thing as a report without a status.                                       |
| **Acknowledged** | Somebody has seen it and will act. This is what makes "how long until someone responded" a real number.                                                       |
| **In progress**  | Being worked on now.                                                                                                                                          |
| **On hold**      | Real, but stalled — waiting for a part, a person, a decision. Different from _In progress_: nobody is working it, and the wait is not the technician's fault. |

**One finished state:**

| Status       | Use it when       |
| ------------ | ----------------- |
| **Resolved** | The work is done. |

> **Nothing is resolved with an empty work log.** Moving an entry to a finished
> state needs at least one entry in its work timeline, so an issue cannot be closed
> without a record of what was actually done — that record is what the points are
> scored against, and an entry closed with none cannot be scored at all. Log the
> work first, then resolve it. The states that end a report **without** it being
> fixed — Duplicate, Not an issue, Rejected — do not ask for one, because no work
> was done.

**Three ways a report ends without being fixed:**

| Status           | Use it when                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate**    | The same thing is already reported elsewhere. Link the other report as a recurrence so the history stays joined up.                                                                                                          |
| **Not an issue** | You looked, and there was nothing to fix — the noise was normal, the reading was right. Not a criticism of whoever raised it: checking was still work, and a report that turns out to be nothing is still worth having made. |
| **Cancelled**    | It was real, but the work is no longer wanted.                                                                                                                                                                               |

### Which moves are allowed

- **Freely among the four working states.** Real work does not run in a straight
  line: something goes on hold, comes back, goes on hold again.
- **From any working state to any finished one.** Something can be resolved without
  ever being formally acknowledged.
- **From finished back to a working state** — that is a **re-open**, and it is
  recorded.
- **Not from one finished state to another.** Marking a _Resolved_ report as
  _Duplicate_ would erase the fact that it was ever resolved. Re-open it first; the
  record then shows both.

### Where a report starts

An **issue** begins at **Open**, filled in for you. A **work log** — including one
made from a finished task with **Complete & log work** — begins **Done**, because the
work is already done; that is why there is a report at all.

### Who can change it

The person who raised the report, whoever is currently holding it, and anyone above
either of them in the reporting line. If the control is a plain label rather than a
dropdown, the report is not yours to move.

Changing the status still works **after a report has been scored**. The lock that
comes with scoring freezes the _content_ — so a figure cannot end up describing work
that changed underneath it — and a status is not the content. An issue can be scored
while resolved and re-opened the next day.

> **Three statuses were removed** because nobody could tell them apart:
> _Partially completed_ meant the same as _In progress_, and _Completed_ and _Closed_
> were two more words for _Resolved_. "Closed" would have earned its place if there
> were a verification step after resolution — and there is one: the appraisal.
> _False complaint_ was renamed **Not an issue**, because the old name blamed the
> reporter for reporting.

## Tags — labels you choose

A report has **one category** — what kind of problem it is — and **any number of
tags**. That is the whole difference, and it is worth holding onto: the category is
what the "keeps happening" analysis counts by, so it stays a single answer; tags are
anything else you might want to search by later ("safety", "warranty", "night shift").

Tags belong to a department, like categories, so two departments can each keep a
"leak" and mean their own thing. Each has a colour, chosen for you when it is
created — you can pick your own instead, under **Report setup → Tags**.

A tag you no longer want is **retired**, not deleted: it stops being offered on new
work, and the reports already carrying it keep it. Deleting one that is in use is
refused for that reason.

## Talking about a report

Every report and every task has a **conversation** at the bottom. **Posting needs
no permission at all**: anyone who can open the record can read it and join in —
the person who filed it, whoever is working it, and everyone up their reporting
line.

- **Reply** to a comment to keep an exchange together. One level of nesting, so a
  thread stays readable.
- **A locked report can still be discussed.** Once a report has been marked, its
  content freezes so the mark cannot end up describing work that changed afterwards
  — but the conversation stays open, because that is usually exactly when there is
  something to say.

**Changing what has already been said is a different matter**, and it is granted
rather than assumed — a comment on a report is part of the record of what
happened. What you can do depends on the rights your role carries:

|                              | Who has it as delivered     |
| ---------------------------- | --------------------------- |
| **Correct your own** comment | Everyone (Member and above) |
| **Delete your own** comment  | Manager and above           |
| **Delete somebody else's**   | Administrators              |

An edited comment is marked as edited, so nobody mistakes it for the version that
was replied to. If a button you expect is missing, it is your role rather than a
fault — an administrator can grant `comments:update`, `comments:delete` or
`comments:moderate` to any role.

> **Nobody can rewrite somebody else's words** — not a manager, not an
> administrator. Removing a remark is a moderator's job; editing one would be
> putting words in another person's mouth, so the app offers no way to do it.

## Handing work over

A report records **who filed it** and, separately, **who is holding it now**.
**Whoever files it holds it** — you do not have to claim your own entry.

- **Hand over** on the report detail passes it to **a colleague in one of your
  departments**, to anyone below you in the reporting line, or back to yourself, with
  an optional reason. Colleagues matter most: a handover usually goes to whoever picks
  the job up on the next shift, who is a peer rather than a subordinate.
- You can hand it back to **nobody**. Work gets put down before the next person
  picks it up, and pretending otherwise would make people pick a name at random.
- Every change is kept: the panel lists who took it, from whom, who moved it and
  why. That trail cannot be edited or deleted.
- **Handing over moves the right to edit.** The entry can be edited by whoever holds
  it — not by whoever filed it — so passing it on passes on the ability to correct it.
  With the entry put down and held by nobody, the author may edit it again. What you
  logged, your score and your place on _who worked on it_ stay yours either way.

## Who worked on it

**Who worked on it** is a list on the report — everyone who put time in, not just
whoever typed it up. Whoever raised the report is on it automatically, and the picker
offers your colleagues, so a second pair of hands can be added by the person who was
actually there.

This list is only **who took part**, not how the points divide — that is scored
separately, once the report is resolved (see below). **Add and remove people as the
work happens:** somebody joins on Tuesday, put them on the list on Tuesday. The record
of who worked on something should be correctable the moment it is wrong. Removing
somebody who was already scored takes their score with them.

## Who sees your report

- **A draft:** only you.
- **A submitted report:** you, and everyone above you in the reporting line — your
  manager, their manager, and so on. Nobody to the side, and nobody below you.

If you manage people, **Reports** shows yours _and_ everyone's beneath you.

## Scoring — points in two tiers

Once a report is **resolved**, it is scored on the **Points** card, in real points,
half-point steps. There are two tiers, and which one you fill follows from who you are:

- **The self split.** The person who raised the report gives each worker a number of
  points — how the credit divides among everyone who worked it. You score people
  directly (you 6, a colleague 2); the numbers are yours to set, not a fixed pot.
- **The management review.** The reporting manager gives their own points for the same
  workers. It starts from the self split so they confirm or nudge rather than retype.
  **The review is what officially counts**; until a manager reviews, the self split
  stands.

Both tiers are kept and shown side by side to the manager. Scoring is **blind upward**:
a worker sees only the self split — **never** the review made of them, nor the official
figure it sets. Those are for the reporting manager and above.

**One report is worth at most ten points**, shared out among everyone who worked it.
Adding a name divides the ten; it never mints more. The card shows the running total,
and a split that adds up to more than ten cannot be saved — so two people cannot each
be given six.

**Once a manager has reviewed, the self split is locked.** The person who raised the
report can no longer change the numbers — that would move points out from under a review
that already stands on them. If the split is genuinely wrong, the **manager re-opens the
report** (see below); that is the deliberate, recorded way to open it up again.

The "My day" strip at the top of **Reports** shows the resolved reports in your downline
still **awaiting your review** — your to-do list as a manager.

> A report **locks** once it has been scored, so a figure is never left standing
> against work that changed afterwards. Points are only for finished work: **re-opening**
> a report clears its scores, and it must be resolved and scored again. Either the author
> or a manager above them can re-open it — for an issue, by moving its status back to a
> working state; for a work log, with the **Re-open** button. That is how a manager frees
> a report whose points need changing after a review.

## Points

- A worker's **official points** are the review if a manager gave one, otherwise their
  self number.
- Your **own points** are the official points from every report you worked.
- A **share rolls up** to each manager above a worker, fading with distance up the whole
  reporting line (a quarter per level by default) — so a manager earns from their team,
  and their own manager a smaller slice above that.
- **Every figure is rounded to a half-point** — the scores you enter and the roll-ups
  alike, so nothing lands off the 0.5 grid.

Your total, and the split between your own and your team's, is on the "My day" strip.
An administrator can tune how much rolls up (Settings), and changing it never
disturbs points already frozen.

> **Points are frozen when a report is scored.** Changing the roll-up setting later
> only affects reports scored _after_ the change. Nothing already earned is rewritten.

## Your day at a glance

The top of **Reports** is a **My day** strip — the first thing you see, because it is
about your work rather than everyone's. It shows only the tiles that are yours to see:

- **Your points** — your own, and the share that rolled up from your team.
- **Filed today** — the reports you have logged since midnight _your_ time (the app
  uses your computer's clock, so a late shift stays in the right day), and a count of
  any half-finished drafts waiting to be submitted.
- **Awaiting your mark** — reports below you that still need appraising. Only appears
  if you appraise.
- **Still down** — outages _you_ opened and have not closed yet, each counting up from
  when it started. Only appears if you record downtime.
- **On your plate** — open tasks assigned to you, soonest due first, with anything
  overdue flagged.

A tile you have no business seeing is simply absent — the strip never shows an empty
"nothing to close" box to someone who does not close things.

## What keeps breaking — analytics

If you manage a line, **Analytics** answers the question a report on its own cannot:
_is this getting better or worse?_ Pick an asset and a time window.

- **Failures** — how many times something under that asset went down in the window.
- **MTTR** (mean time to repair) — how long a fix takes on average, across the outages
  that have been _closed_. An outage still running is counted as a failure but left out
  of this average, because it has no repair time yet.
- **MTBF** (mean time between failures) — how much running time there is, on average,
  between breakdowns. Bigger is better.
- **Availability** — the share of the window the equipment was actually up.
- **Breakdown** — the same figures for each thing _under_ the asset, worst first, so
  "which station on Line 3 is the problem" has an answer.
- **Keeps happening** — issues that have come up more than once on the same thing,
  grouped by category, with how often. Something that happened once is not listed — one
  time is not a pattern.

Two things worth understanding so the numbers do not mislead you:

- **A dash ("—") is not zero.** MTBF shows a dash when nothing failed in the window —
  the equipment has not been _measured_, which is different from measuring badly. MTTR
  shows a dash when nothing has been closed yet.
- **The window is part of the answer.** MTBF over a week and MTBF over a year are both
  right and different, which is why the window you chose is shown next to the figures.

The figures roll up the whole tree: an outage logged on a single machine counts toward
its station, its line and its plant, without anyone logging it three times. Analytics is
for managers and administrators — it counts across everyone's reports, so it is not shown
to people who only file their own.

Every report also carries its own small history: open a report and the **History** panel
shows each status change, who made it, how long it took to be picked up, and how long to
fix. If a report is part of a chain of repeats, a **Seen before** panel links the others
you have access to.

## A note on the scoreboard

Points are visible to you and to your managers — there is no company-wide leaderboard.
The aim is honest reporting from everyone, not a competition: a filed problem is worth
more to the organisation than a tidy score, so report the breakdowns.

## For administrators

The catalogues that shape all of the above — the severity ladder, the status
workflow, and each department's categories — are under **Journal setup**; the asset
tree and the device registry are under **Assets** and **Devices**; and the roll-up
factor is under **Settings**. See [Configuration](configuration.md).
