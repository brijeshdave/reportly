# Worked examples

The other pages explain what each feature does. This one follows an IT department
through a fortnight of ordinary work, so you can see how the pieces meet.

The team: **Asha** heads IT. **Ravi** leads infrastructure and reports to her.
**Mei** and **Tom** are engineers reporting to Ravi. They cover one site, `Head
office`, with a `Plant 1` next door.

---

## A printer stops, and the line stops with it

Friday, 09:40. The label printer on Line 2 jams and production halts.

**Mei files it.** Journal → New entry → **Issue / breakdown**.

| Field         | What she puts                                             |
| ------------- | --------------------------------------------------------- |
| Title         | `Label printer jamming on Line 2`                         |
| Department    | Infrastructure                                            |
| Category      | `Peripheral`                                              |
| Tags          | `printer`, `production`                                   |
| What is about | The device `PRN-0007`, which stands at `Plant 1 → Line 2` |
| Severity      | Major                                                     |

She points it at the **device**, not the line. Because that device records the
asset it stands at, the entry rolls up to Line 2 and to Plant 1 on its own — she
never has to think about the tree.

**She records two different numbers**, and this is the distinction people get
wrong:

- **Downtime** — 09:40 to 10:15. Production stopped for 35 minutes.
- **Work time** — 2 hours. She was engaged with it well past the restart,
  watching whether the jam recurred.

Those disagree on purpose, and both are true. The printer's type has "tracks
downtime" switched on, so Reportly asked for it. Had this been somebody's laptop,
it would not have — a laptop failing is not a line stopping.

::: tip Leave "back up" empty while it is still down
An open downtime shows in **Downtime → Still down** and counts up to _now_
instead of reading as zero. Fill the end time in when it is genuinely fixed.
:::

**It comes back on Monday.** Mei reopens rather than filing a new one, and links
the recurrence. Two entries, one problem — which is what makes it show up in
**Analytics → what keeps happening** rather than looking like two unrelated jams.

**Scoring.** Mei splits the credit — she did it alone, so all of it to herself —
and submits. Ravi reviews it in **Reviews** and sets the official figure. He can
move it in either direction; Mei sees only her own split, never his review.

The entry is worth at most 10 points however many people worked it. Adding a name
divides the ten; it never mints more.

---

## What the cartridge did next

That printer eats cartridges, and IT refills them rather than buying new.

**Tom refills TN-0044.** Cartridges → the register → **Refill**. He records the
toner used — the service kind decides what may be consumed, so Refill offers
toner and not spare parts. The refill earns him points.

**He installs it**, choosing the printer from a picker that offers only devices
the model actually fits, and records the meter reading.

**Nine days later it fails.** He takes it out and marks the return **faulty**.

Two things happen without anybody asking:

- The failure is inside the module's **failure window**, so the points for that
  refill are **reversed** — not edited away, but a compensating entry, because the
  ledger is append-only and history is not rewritten.
- The tour is recorded with what it printed against the model's rated yield.

**The question that matters** is whether the cartridge is bad or the printer is.
Cartridge health answers the first; **printer health** answers the second by
counting _distinct_ cartridges that failed in each machine. One cartridge failing
repeatedly says nothing about the machine. Three different ones failing in the
same printer says a great deal.

---

## The weekly check nobody remembers

Backups need verifying, and "someone will remember" is not a plan.

**Asha creates a routine.** Team routines → New: _Verify last night's backup
restored cleanly_, weekly, assigned to Ravi's team.

It appears in each person's **My routines** with a due date, and logging an
occurrence is what counts towards compliance. At month end, compliance turns into
points automatically.

The value is not the points. It is that **Analytics** can now show a month where
the check was missed three weeks running, which is a conversation worth having
before the restore is needed rather than after.

---

## Who is on, and who swaps

IT covers 07:00–19:00 across two shifts.

**Asha builds the rota** in the department's Schedule. **Tom needs Thursday
off** and asks Mei to swap — Shift change → pick the shift, pick the colleague.

The request routes to whoever has to approve it, both of them are told the
outcome, and the calendar updates. Nobody maintains a spreadsheet, and — the
actual point — the rota is on the record when somebody later asks who was on when
the incident happened.

---

## The figures, at month end

Asha needs three different things, and they are three different screens:

**Reliability — Analytics.** Pick `Plant 1` and the month. MTBF, MTTR and
availability, rolled up through everything under it, with a per-child breakdown so
the worst offender is visible rather than inferred.

A dash means **not measured**, never zero. A machine that never failed has no
MTBF — unmeasured is not the same as perfect, and a chart that showed 0 there
would be lying.

**Shape of the work — Insights.** Issues against work logs over time, what kind
of problem keeps coming up, where entries stand, who is doing what. Every chart
has a **Table** button, which is what you use when somebody wants the actual
number rather than the shape.

**Who did what — Reports.** A saved view over the journal, filtered to a person or
a team, printed or exported to a spreadsheet. This is the one that goes into a
review meeting.

::: tip Points are a record, not a scoreboard
They are visible to a person and to their managers, and there is no company-wide
leaderboard. A filed problem is worth more to the organisation than a tidy score
— which is why reporting a breakdown must never cost somebody points.
:::

---

## The Monday morning question

_"What is on my plate?"_

**Journal → My day**, which is where the app opens. Your points, what you filed
today, anything of yours still down, your open tasks, and what is waiting to be
scored.

**Reviews** answers the other half — the entries waiting on _your_ score if you
manage people, and your own work waiting on your manager if you do not. That
second half exists so a person can tell the difference between work nobody has
looked at yet and work that has been scored.

---

## Where to go next

| To do this                       | Read                                     |
| -------------------------------- | ---------------------------------------- |
| Set it all up from scratch       | [Your first day](ops/first-day.md)       |
| Understand scoring properly      | [The Journal](reporting.md)              |
| Decide who is told what          | [Notifications](user/notifications.md)   |
| Load an existing device list     | [Import & export](user/import-export.md) |
| Turn cartridges on for a company | [Cartridges](user/cartridges.md)         |
| Change what a setting does       | [Configuration](configuration.md)        |
