# Notifications

Reportly tells you when something happens that concerns you: an entry lands in
your hands, a colleague asks to swap a shift, your work is appraised. Every
notification appears in the bell at the top of the screen, and can also reach you
by email or one of the messaging channels your organisation has set up.

![The notification bell](../screenshots/notifications-bell.png)

---

## The bell counts what is waiting on you

The number on the bell is how many things are **waiting on you to do something** —
work handed to you, an entry ready for your review, a swap wanting an answer. It is
not everything unread. It refreshes on its own about once a minute, so you do not
have to reload the page.

That split is the point. Everything still arrives, because the bell is meant to be a
complete record of what concerns you — but a number counting twenty-odd kinds of
event at once is a number nobody acts on, and the thing needing an answer ends up
sitting between two things that do not.

Click the bell to see what is waiting, eight at a time. Clicking one takes you to the
thing it is about and marks it read — you do not have to do both. When there is other
news, the panel says how much and where to find it.

**See all notifications** opens the full list, with three tabs:

| Tab            | What is in it                                                                  |
| -------------- | ------------------------------------------------------------------------------ |
| **Needs you**  | Things waiting on you. This is what the bell counts, and it opens here.        |
| **Activity**   | A record of what happened around you — a status moved, a comment, points paid. |
| **Everything** | Both, newest first.                                                            |

You can mark things read one at a time or all at once, and remove ones you have
finished with.

Read notifications are tidied away automatically after a while (your
administrator sets how long). Anything you have **not** read is never removed.

### Notifications and companies

If you work in more than one company, the bell shows what belongs to the company
you are currently in. Switch to **All companies** in the top bar to see
everything at once.

---

## Choosing what you receive

**Your account → Notifications** is a grid: the kinds of notification down the
side, the channels across the top. Tick a box to receive that kind on that
channel; untick it to stop.

![Choosing what you receive](../screenshots/notifications-preferences.png)

Press **Save preferences** when you are done — nothing is saved as you click.

### Why a box might be greyed out

Two different reasons, and they need different fixes:

| What you see                                                | What it means                                             | What to do                                              |
| ----------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| The box is greyed and says your administrator turned it off | Your organisation does not send that kind on that channel | Ask an administrator — you cannot switch it on yourself |
| The box is greyed and asks you to verify the channel        | You have not proved that phone number or handle yet       | Go to **Your account → Channels** and verify it         |

Only email and the in-app bell work out of the box. SMS, WhatsApp, Telegram and
Discord each need two things: your administrator has to configure a provider, and
you have to verify your own address on that channel.

### A box you tick back on

Ticking a box back on does not just re-enable it for you — it puts that cell back
to _following the default_. So if your administrator later changes what everyone
receives for that kind of notification, you will follow the change. Leaving a box
unticked is a decision that sticks.

---

## What Reportly notifies you about

| Group    | You are told when                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Journal  | an entry is assigned to you; somebody comments on yours; its status changes; it is appraised, rejected or reopened; somebody in your reporting line files work that needs your review |
| Tasks    | a task is assigned to you; a task changes hands; a task you are on is regraded; a task you hold falls due within a day                                                                |
| Shifts   | a colleague asks to swap with you; your swap is approved or refused; your department's roster is published                                                                            |
| Routines | a routine of yours is due tomorrow; one has gone past its date unlogged; month-end routine points are awarded to you                                                                  |
| Downtime | downtime is opened or closed on your department's equipment                                                                                                                           |
| System   | a backup fails; background jobs are failing; somebody is invited; somebody is locked out of sign-in; a company is deactivated (administrators only)                                   |

You are never notified about something you did yourself.

### Reminders are said once

The due-soon and overdue reminders come from a job that runs once a day, and each
one is sent **once per occurrence**. A routine you have not logged does not
reappear every morning until you do — you are told once, and told again only when
the next occurrence of that routine comes round.

Two consequences worth knowing:

- Moving a task's due date counts as a new deadline, so you will be reminded
  about it again.
- A reminder that is more than a week old is not sent at all. If you turn Reportly
  on against months of existing work, you are not buried in a year of history.

**Not notifications:** password resets, two-factor changes and invitations are
sent by email regardless of anything on this page. They are security messages
about your account, and there is deliberately no way to switch them off.

---

## For administrators

**Settings → Notifications** has two parts.

![The administrator's matrix](../screenshots/notifications-settings.png)

**Delivery** is the master switch for each channel, plus how long a read
notification is kept.

- **In app** and **Email** are on by default.
- **SMS, WhatsApp, Telegram, Discord** are off by default, because they need a
  provider configured under **Settings → Channels** first. Switching one on
  without a provider does not fail loudly — every message simply fails in the
  background — so leave it off until the provider works.
- **Retention days** removes _read_ notifications older than that. `0` keeps them
  for ever. Unread ones are never removed.

**The matrix** below it sets, per kind of notification, which channels it goes
out on. What you tick here is two things at once:

- **the default** — anybody who has not changed their own preferences gets
  exactly this, including people who joined before you changed it
- **the ceiling** — a person can switch off any of it, but cannot switch on a
  channel you did not tick

Changing the matrix therefore changes what most of your organisation receives
immediately. Somebody who has explicitly unticked a box keeps their choice.

A channel switched off under Delivery does not appear in the matrix at all.

### Troubleshooting

**"Somebody says they got no email."** Check in this order:

1. **Settings → Notifications → Delivery** — is Email enabled?
2. **The matrix** — is Email ticked for that kind of notification?
3. **Their preferences** — they may have unticked it themselves.
4. **The mail server** — run `cli doctor` on the server. Mail is queued, so a
   broken relay shows up as silence, not as an error on screen.

**"Nothing at all arrives, not even the bell."** The notification worker runs
inside the API process. Check the API is running and Redis is reachable
(`cli doctor` covers both). Notifications are queued, so if Redis is down they
are not lost immediately — but the queue does not drain until it comes back.

**"Somebody is getting too much."** Point them at **Your account →
Notifications** first. If a whole kind of notification is noisy for everybody,
untick its channels in the matrix rather than asking people to mute it one by
one.

---

## For administrators

### Which events are worth interrupting somebody

**Settings → Notifications** is the grid that decides what fires and how loudly. Each
kind of notification is a row; the channels are the columns; and the first column is
**Needs you**.

Untick **Needs you** to move a kind into **Activity**. It still arrives and is still a
record — it simply stops counting on the bell and stops competing for attention with
the work. Kinds that are only ever a record cannot be moved the other way: the
catalogue decides what a notification is at most, and a local decision can only make
it quieter.

Untick every channel on a row to stop that kind being sent at all. That is the answer
to "stop telling me every time somebody files an entry".

### Telling managers when somebody goes quiet

**Off by default.** An installation that has not decided what "quiet" means for its
own people should not start mailing managers about them — and the first run against
an established database would otherwise post about everybody who has ever been on
leave.

Switch it on under **Settings → Notifications**, where four things are yours to set:

| Setting          | What it does                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enabled**      | Whether the alert runs at all.                                                                                                                                            |
| **After days**   | How long somebody must have logged nothing before it fires. Seven by default.                                                                                             |
| **Kinds**        | Which activity counts as logging something. Leave empty for all of it, or pick one — watching only routines finds the person who files entries and skips their rounds.    |
| **Upline depth** | How far up that person's line the alert climbs. **Three** by default, unlike the general setting below: silence is exactly what the people further up want to know about. |

It asks the same question the [Gone quiet report](workload.md) asks, on a timer
instead of on demand, and uses that report's query — so a manager reading the report
and a manager getting the alert can never disagree.

**It says it once per silence, not once a day.** The alert is remembered against the
date of the person's last activity, so a quiet fortnight is reported once. The moment
they log anything, that changes, and a later silence earns a new alert. Repeating it
daily is what teaches somebody to mute the channel, and then they miss the ones that
mattered.

Which channels it goes out on is the matrix above, like every other kind.

### How far up the line an event travels

When somebody's work needs reviewing, the people told are their managers. **How far
up** is yours to set, under the same Notifications settings:

- **Upline depth** — 1 by default, meaning your own direct reports and nobody else's.
  Raise it if you want to see two or three levels down.
- **Stay within one department** — on by default. A person may belong to more than one
  department, each with its own manager. With this off, their work climbs _every_ chain
  they belong to, so a head of department can be told about people they have never
  managed.
