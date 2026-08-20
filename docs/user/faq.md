# FAQ — using Reportly

Short answers to the things people actually ask. If your question is about
installing or running the server, see the [operator FAQ](../dev/faq.md) instead.

---

## Signing in and my account

### I have been invited but there is no email

Invitations are sent by your organisation's mail server. If nothing arrives:

1. Check spam — the sender is whatever your administrator configured, often
   `no-reply@` your company domain.
2. Wait a minute. Mail is queued, not sent inline, so it can lag the invitation.
3. Ask your administrator to re-send it. If mail is misconfigured they will see
   it immediately by running `cli doctor` on the server.

An invitation link expires. If yours has, ask for a new one rather than trying
to register — self-registration is off in most installations.

### I have forgotten my password

Use **Forgot password** on the sign-in screen. You will get a link by email.

If you also cannot receive email, an administrator can set a password for you
directly (they need `users:reset-password`). The password they set forces a
change at your next sign-in and signs out every existing session.

### I have lost my phone and my two-factor codes

Your recovery codes were shown once when you enrolled. If you still have them,
use one instead of the six-digit code.

If both are gone, an administrator with `users:manage-2fa` can remove your second
factor so you can enrol again. If _you_ are the only superadmin and you are
locked out entirely, someone with server access runs:

```bash
cli reset-2fa you@example.com
```

### It says my password has expired

Your organisation has password expiry turned on. Sign in and you will be asked
for a new one. It cannot be the same as your recent passwords — reuse is checked.

### Why can I not see anything after signing in?

An invitation grants an identity, not access. You see nothing until an
administrator puts you in a **group**. Ask them to.

If you can see the app but not a particular screen, you are missing that area's
permission — again, a group question.

---

## Filing work

### What is the difference between the Journal, Tasks and Routines?

|              | What it is                                                           | Who starts it       |
| ------------ | -------------------------------------------------------------------- | ------------------- |
| **Journal**  | The record of what happened — an issue you found, work you did       | You                 |
| **Tasks**    | Work somebody asked you to do                                        | Someone else        |
| **Routines** | Recurring duties on a schedule — the weekly check, the monthly clean | Set up once, recurs |

A journal entry is the thing that earns points. Tasks and routines are about
what needs doing.

### I cannot file an entry for last week

Your organisation has a **grace period** — entries can only be backdated so far.
It exists so the record reflects what happened when it happened, rather than
being reconstructed at month end.

The window is counted from **when the issue occurred**, not when you are typing.
If you genuinely need to record something older, ask a manager: they can file it,
or the setting can be relaxed.

### Why can I not edit my entry any more?

Two possibilities:

- **It has been scored.** Once points are awarded the content locks, so the
  thing that was scored is the thing that stays on the record.
- **It has been rejected.** A head of department can reject an entry, which
  voids its points.

The conversation is never frozen. You can still comment on a locked entry —
that is deliberate, because the discussion often matters more after the fact.

### Can I delete an entry I filed by mistake?

Your own entries, yes. Other people's, only if you have been given
`journal:delete` — normally a Journal admin.

If it is a scoring problem rather than a mistake, rejecting is usually better
than deleting: it voids the points and leaves the record of why.

### What is "handover"?

Passing an open entry to someone else — going off shift with something
unfinished. The handover is recorded, so the trail shows who held it when.

### Someone else worked on this with me

Add them as a **participant**. Note that participants do not earn points — the
ledger credits the author. If the work should be shared, the scoring split is the
mechanism, not participants.

---

## Points and the leaderboard

### How are points calculated?

Two tiers. You score your own entry, and a reviewer scores it too. The review can
override yours, and it can go up as well as down — a reviewer who thinks you
undersold your own work can say so.

Everything moves in half-steps, and an entry caps at ten points.

### My points changed after I was scored

Someone re-opened the review, or the entry's status changed and the points were
re-evaluated. Every entry has a **points history** tab showing each change and
who made it.

### Why is my entry worth nothing?

Most likely it was **rejected** by a head of department, which strikes its points.
The reason is on the entry.

### Why can I not see the leaderboard?

It needs `leaderboard:view`. It is also scoped to your own reporting line, so you
see your part of the organisation, not all of it.

### Can I be left off the leaderboard?

Yes — a user can be opted out. Ask your administrator.

---

## Finding things

### The asset picker will not show the machine I want

The picker walks down the tree: site, then line, then station. You can **stop at
any level** — whatever you last chose is the answer, so you do not have to reach
a leaf.

If a machine is missing entirely, it is either retired or at a site you do not
have access to. Assets are scoped by location.

### Someone cannot pick a department when filing an entry

If the form says "You are not in a department yet" and the site reads "Not set" for
somebody who _is_ in a department, they are on a version before this was fixed. The
form used to ask the administrative lists for its choices, so filing an entry
quietly required permission to _manage_ departments and sites.

It now asks only for their own placement, which needs no extra permission. The same
applied to the shift-change request and the routine editor.

### A user says the app is empty — no menu, nothing works

Check which company is selected in the top bar. Permissions are resolved **per
company**, so "All companies" means no company, and no company means no
permissions: an empty sidebar and a refusal from every screen. It looks exactly
like their access has been taken away.

Ordinary users are no longer offered that option and are put into their own
company automatically, so this should not happen — but an older browser tab may
still be sitting in that state. A reload fixes it.

If the sidebar is still empty afterwards, they genuinely hold no permissions in
that company: open **Users → _the person_ → Effective access** to see what they
resolve to, and check their group carries a role. The dashboard also shows a
**Permissions** count for whoever is signed in, which is the quickest check of all.

### The department list shows the same name twice

You are in a department of that name at more than one company. Names are unique
within a company but not across them, so "Maintenance" at two companies is two
different departments. Each entry names its company on the line underneath, and
nested departments show their parents there too.

Forms that create something offer only the departments of the company picked in
the top bar. If the one you want is missing, switch company there first.

### Why do I see fewer entries than a colleague?

Visibility follows the reporting line and the sites you are placed at. You see
your own work wherever it was filed, plus what your position in the tree gives
you. A colleague higher up the line, or at more sites, sees more.

### What is the difference between a category and a tag?

A **category** is single-select and drives the analytics — "what keeps breaking"
groups by it. **Tags** are multi-select labels your department defines for its
own searching. Use the category for what it is; use tags for how you want to find
it later.

---

## Reports and exports

### Report or journal — which is which?

The **Journal** is the raw record. **Reports** are saved views over it — "issues
this month", "reliability by device" — that you run, print or export.

### Can I change a shipped report?

Not in place; they are system views. **Clone** it and change the copy. Your clone
is yours, and you can share it with your team.

### My export opened in Excel and looks odd

Exports are real `.xlsx` files. If a cell looks like a formula rather than text,
tell your administrator — that is worth reporting, not working around.

### What is MTBF and MTTR?

**MTBF** — mean time between failures: operating time divided by the number of
failures. **MTTR** — mean time to repair: the average time to close one.

MTBF shows as **—** rather than zero when nothing has failed. Unmeasured is not
the same as perfect, and a big number there would be a lie.

---

## Shifts

### How do I swap a shift?

Open the schedule, find your cell, and raise a **shift change**. You can suggest
a colleague to swap with, or leave it open for whoever decides.

You can only change your **own** cell, and only a working shift or a weekly off —
leave and public holidays are not swappable.

### Who approves my swap?

Your reporting manager, or someone holding `shifts:approve`. Approving is
deliberately separate from building the schedule, so a supervisor can decide
swaps without owning the roster.

### I raised a request by mistake

Withdraw it while it is still pending.

---

## Notifications

### The bell shows a number but the list is empty

The bell counts notifications for the company you are currently in. If you have
just switched company, the count and the list are both for the new one — try
**All companies** in the top bar.

### I am not getting emails, only the bell

Three things have to agree, in this order: your administrator has to enable email
under **Settings → Notifications**, they have to tick Email for that kind of
notification, and you have to leave it ticked on **Your account →
Notifications**. If the box is greyed out on your screen, the first two are the
ones to ask about.

### A checkbox is greyed out and I cannot tick it

Hover it and it says why. Either your administrator does not send that kind on
that channel — nothing you can do from your side — or you have not verified that
channel yet, which you do under **Your account → Channels**.

### Can I get notifications on WhatsApp or Telegram?

Only if your administrator has set up a provider for it. Those channels are off
until somebody configures the gateway; verified or not, nothing is sent until
then.

### I turned something off and it came back

Ticking a box back on means "follow the default" rather than "always send me
this", so a later change by your administrator will apply to you. If you want it
off, leave it unticked — that choice sticks.

### Notifications older than a few months have gone

Read ones are removed after the period your administrator sets (90 days out of
the box). Anything you have never read is kept indefinitely.

---

## Still stuck

Ask your administrator first — most of the above is something they can change.
Anything that looks like a bug belongs in the project's issue tracker; anything
that looks like a **security** problem should not (see `SECURITY.md`).

## Why can I not record downtime for this machine?

Downtime means **production stopped**, so it is only offered for the kinds of
thing that can stop it. That is decided per **type**, not per machine:

- **Assets** — Plant, Area, **Line**, **Station** and the rest. These record
  downtime by default, because they are the production structure.
- **Devices** — Desktop, Laptop, Switch, Printer. These do **not** by default: a
  dead PC is a job to do, not an outage to measure.

Switch it either way in **Assets → Types** or **Journal setup → Device types**,
with the _downtime_ tick against the type. Turning it on for one type covers every
machine of that kind — one decision for a handful of types instead of one per
machine.

Some devices genuinely do halt production: a label printer on a line, say. Tick
_downtime_ against that device type and its outages become recordable.

A machine with **no type set** is still offered downtime. Nobody has said either
way, and refusing on a fact that was never recorded would lose an outage that did
happen.

**Where it is recorded:** on a saved entry, in the Downtime panel below
Attachments — not on the new-entry form, since downtime attaches to the entry and
to the machine that was down. Your own hours on the job are separate, and go in
_Started work_ / _Finished work_ on the entry itself.
