# Insights

Charts over the work you have already recorded. Nothing here is new information —
it is the journal, the downtime and the points, drawn instead of listed.

Needs **`insights:view`** (the **Insights viewer** role). Deliberately separate
from Analytics, so your organisation can put the charts on a wall screen without
also handing over the reliability figures.

---

## The window

One control, top left, applying to every chart on the page. Charts on a page that
each carried their own range would invite comparing two different periods without
noticing.

The **buckets follow the window**, which is why a 30-day view is daily and a
year is monthly. Daily buckets over a long window show the sampling rate rather
than the trend: most days hold nought or one entry, and the line sawtooths
between them.

Every chart states the period it covers underneath its title. A figure without
its window is not a figure.

---

## The tabs

**Overview** — issues and work over time, what kind of problem keeps coming up,
and where entries stand between open and finished.

**Reliability** — downtime by asset, worst first. Only **closed** spans count: an
open one has no end, so including it would mean picking a number that changes
every time you refresh, and a bar that grows while you look at it is not a
measurement.

**People** — points by person and by department. Points earned **directly**, not
counting what rolls up a reporting line, so a head of department does not appear
to have out-worked their whole team.

**Work** — the daily rhythm of what gets recorded.

---

## Reading them

**Every chart has a table.** The button top-right swaps the picture for the
numbers it was drawn from. Use it when you want the actual figure, when you are
copying something into a report, or when the colours are hard to tell apart.

**Two lines on one scale.** Issues and work logs share an axis because both are
counts of journal entries. Charts that give two measures their own axes can be
made to cross wherever the author chose, which is the most common way a chart
misleads — so this one does not offer that.

**A long tail folds into "Other".** Past six categories the rest becomes one
remainder. Thirty bars is a table pretending to be a picture.

**An empty chart says so in words.** "No downtime was closed against an asset in
this window" is different from nothing having happened, and an empty axis cannot
tell you which you are looking at.

---

## On the dashboard

A single tile: the last 30 days of filing, with the totals in text beside it.
It appears only if you hold `insights:view`, like every other tile on that
screen — an absent tile means "not yours", not "nothing to show".

---

## Common questions

**A chart is empty but I know there is data.** Check the window, and check the
company in the top bar. Every chart is scoped to the company you are working in.

**Why are my points lower here than on the leaderboard?** These are direct points
only. The leaderboard adds what rolls up from the people who report to you.

**Can I export a chart?** Not as an image. Switch to the table view and copy from
there, or use **Reports**, which exports properly to a spreadsheet.

**The colours look the same to me.** Use the table view — it carries the same
numbers. The palette is checked for colour-vision deficiency, but a table is
always more precise than a hue.
