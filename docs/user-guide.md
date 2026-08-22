# User guide

Reportly shows you only what you may use. If a page or button is missing, your
groups do not grant the permission it needs — the sidebar, the pages and the API
all consult the same rule.

Each task below names the permission it requires. A **superadmin** bypasses all of
them.

## Everyone

These act on your own account, so they need no permission at all. Click your name
at the bottom of the sidebar.

| Task                           | Where                              |
| ------------------------------ | ---------------------------------- |
| Change your name               | Your account → Profile             |
| Set a profile picture          | Your account → Profile             |
| Change your password           | Your account → Security            |
| Turn on two-factor             | Your account → Security            |
| Verify your contact details    | Your account → Channels            |
| Choose what you are told about | Your account → Notifications       |
| See where you are signed in    | Your account → Security → Sessions |
| Pick a theme and page size     | Your account → Preferences         |

### Choosing from a long list

Anywhere the app asks you to pick a **person, department, site, asset, device or
model**, the box opens a list you can type into. Start typing any part of what you
are looking for — the list narrows as you type, and it searches the smaller second
line as well as the name, so "platform" finds the person in Platform and "acme"
finds the department at Acme.

It works without a mouse: **↓** opens it, **↑ ↓** move, **Enter** chooses, and
**Esc** closes it without changing anything. Where you may pick several people,
Enter adds or removes one and the list stays open so you can keep going.

Short fixed lists — priority, cadence, a status — stay as ordinary dropdowns.
There is nothing to search in five words you can already see.

### Filing journal entries

Everyone logs their work under **Journal** — an **issue/breakdown** or a routine
**work log**. Save a **draft** to finish later (private to you), or **submit** it so
the people above you in the reporting line can see and score it.

The Journal opens on **My day**: your points, what you filed today, anything of
yours still down, what is on your plate, and what is waiting to be scored. The
**Entries** tab beside it is the full table, filterable and sortable.

Point an entry at what it concerns under **What is it about?** — a line, the machines
on it, a department, a person, or nothing at all. Assets come from a short list;
devices are **searched**, since there may be thousands.

The full picture — kinds, how scoring works, and how points roll up — is on
[The Journal](reporting.md) page.

### Work time, and downtime

These are two different numbers and Reportly keeps them apart.

**Work time** is how long _you_ were engaged with the job. Record it on every
entry.

**Downtime** is how long _production_ was stopped. It is only asked for when the
thing you are reporting on is of a type that can actually stop a line — a PC going
down is not a line stopping, and an administrator configures which types count.

The two routinely differ, and that is correct: a machine can be back in five
minutes and still cost you an afternoon of observation.

To record downtime, use the **Downtime** panel on the entry: pick one of the
things the entry is about, say when it went down, and **leave "back up" empty if
it still is**. It waits in **Downtime → Still down** until you come back and fill
the end time in. **Downtime → Totals** is what it has all cost, per machine, worst
first.

### Attaching files

The **Files** panel on an entry takes the photo, the PDF, the exported trace. It is
as private as the entry itself, and it follows the same lock: once the entry has
been scored, **re-open** it to add or remove a file. See
[The Journal](reporting.md#attaching-files).

### Working from tasks

**Tasks** shows what you have been asked to do, and what you have asked of others. You
may assign work to yourself or to anyone below you in the reporting line.

**Complete & log work** opens an entry pre-filled from the task — and **filing that
entry is what completes the task**, so finishing the job and recording it really are
one action. Close the form without saving and the task is simply still open, waiting
for you; nothing is marked done with no record behind it.

If a task is already closed with nothing logged against it, its page says so and
offers **Log the work now**. A completed task is never a dead end.

### Seeing whether your work has been scored

**Reviews** has two halves. If you manage people, the entries awaiting your score
are there. And whoever you are, **your own entries waiting on your manager** are
listed too — so you can tell the difference between work nobody has looked at and
work that has been scored.

### Your points

**My points** shows your own ledger and your team's, with a summary. Points are
frozen once awarded: a correction appears as its own entry rather than by
rewriting what you earned.

### Your shifts

**Schedule** is the department calendar. If you need to swap one, **Shift change**
raises the request with the colleague you want to swap with; it routes to whoever
has to approve it, and both of you are told the outcome.

### Your routines

**My routines** lists the recurring duties assigned to you — the weekly check, the
monthly clean — and what is due. Logging an occurrence is what counts towards
compliance, and month-end awards follow from it.

### Signing in

Use **either your email address or your username** — the same box takes both. Both
are unique to you, and an administrator sets the username when they create your
account (you can ask them to change it).

If an administrator chose your first password, Reportly makes you replace it before
it will let you do anything else. That is deliberate: a password someone else knows
is not one to leave standing.

### Verifying your contact details

**Your account → Channels** lists every way Reportly can reach you: your email, your
mobile, and — if the number is on them — WhatsApp and Telegram, plus Discord if you
have a handle. Only the email is required; the rest are optional.

Beside each, **Verify** sends a one-time code to that address. Enter it and the
channel is marked verified. A few things worth knowing:

- **Only you can do this.** An administrator can record your mobile number, but they
  cannot verify it for you — that is the whole point of verifying it.
- **A code expires** after a few minutes, and dies after a handful of wrong guesses.
  Ask for a fresh one.
- **Changing an address undoes its verification.** A code sent to your old number
  says nothing about your new one.
- **"Unavailable"** means nobody has configured a provider for that channel yet — see
  [Configuration](configuration.md#contact-channels). It is not something you can fix.

### Setting up two-factor authentication

1. **Your account → Security → Set up two-factor.**
2. Confirm your password.
3. Scan the QR code with an authenticator app, or type the setup key by hand.
4. **Save the recovery codes.** They are shown once and never again. Each works a
   single time, and they are how you get back in if you lose your phone.
5. Enter a code from the app to finish.

Two-factor is not active until step 5 succeeds, so closing this halfway cannot lock
you out.

Signing in afterwards asks for a code. If you have lost the authenticator, choose
**Use a recovery code** on that screen.

### If you have lost your authenticator _and_ your recovery codes

You cannot get back in on your own, and no amount of clicking will change that — the
screen that turns two-factor off asks for a code from the device you no longer have.

Ask an administrator to remove it (**Users → you → Security → Remove**). They can
take the factor off; they cannot read it, and they cannot turn it back on for you.
You will be signed out everywhere, emailed that it happened, and can enrol again
after signing in with your password.

If you receive that email and **did not ask for this**, your account is now protected
by its password alone. Change it immediately and tell your administrator.

### If you forget your password

Use **Forgot your password?** on the sign-in page. You will get the same
confirmation whether or not an account exists for that address — that is on
purpose, so nobody can use the form to discover who has an account.

---

## Member

Read-only across the resources in scope for their groups.

| Task             | Permission         |
| ---------------- | ------------------ |
| View users       | `users:read`       |
| View groups      | `groups:read`      |
| View companies   | `companies:read`   |
| View locations   | `locations:read`   |
| View departments | `departments:read` |
| View roles       | `roles:read`       |

Switch companies with the picker in the top bar. Everything below it — the lists,
and the data in them — re-scopes to the company you choose.

---

## Manager

Everything a Member can do, plus creating and updating.

### Read the reliability figures

**Analytics** is a manager's screen. Pick an asset and a window, and it shows how
often things under it failed, how long they took to fix (MTTR), how much running time
there is between failures (MTBF), and how available the equipment was — with a
per-child breakdown so you can find the worst offender, and a "keeps happening" list
of issues that have recurred. A dash means **not measured**, never zero; the window is
shown because the figures move with it. The full explanation, written for the shop
floor, is in [Reporting → What keeps breaking](reporting.md#what-keeps-breaking--analytics).

It counts across everyone's entries under the asset, which is why it stops at Manager
(the `analytics:view` permission) and is not offered to a Member who only files their
own.

### Read the shape of the work

**Insights** is the other half of the picture, behind its own `insights:view`
permission so it can be shown or hidden independently: issues and work over time,
what kind of problem keeps coming up, where entries stand, and who is doing what.

Every chart has a **Table** button. The table is the same numbers the chart is
drawn from, and it is there for the print case, the screen-reader case, and the
"I want the actual figure" case.

### Score your team's work

**Reviews** lists the entries awaiting your score. An entry is scored twice: the
author splits the credit among everyone who worked it, and you review it. Where a
review exists it is the official figure, and it may move the number in either
direction.

The scoring is **blind upward** — the person being reviewed sees only their own
split, never your review. An entry is worth at most 10 points however many people
worked it: adding a name divides the ten, it never mints more.

Re-opening an entry clears its scores and its points. Points are for finished
work.

### Run the reports

**Reports** holds saved views over the journal — issues this month, reliability by
device, downtime, shift coverage, routine compliance. Pick a range and a grouping,
then print or export to a spreadsheet. Filters include a person, so "what did this
team member do, and when" is one report rather than a search.

**Each report is granted on its own.** There is one permission per report —
`reports:view:downtime`, `reports:view:part_register`, and so on — so a shift lead
can be given the rota reports without the cartridge figures, and somebody looking
after printers need not see the leaderboard. A report nobody has been granted does
not appear in the picker, and a saved view built on it is not listed either.

Two things follow:

|                                           |                                                                                                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Viewing includes taking a copy**        | Whoever may read a report on screen may also print it and export it to Excel. Somebody who can see every row can photograph it; a separate export permission per report would be a much longer list to maintain for very little. |
| **A new report starts granted to nobody** | When a new report ships, no role holds it until somebody grants it. That is deliberate — the alternative is an upgrade quietly handing every existing role a report nobody chose to share.                                       |

**What a report shows you** is narrowed the same way the journal is: your own work
and your downline's, in the company you are in, at the sites your access covers.
Two people can open the same report on the same day and see different rows, and
that is the point — the figures are about the part of the organisation you are
responsible for.

### Keep the team's routines

**Team routines** is where recurring duties are defined, assigned and tracked.
Compliance is per person and per routine, and month-end awards follow from it.

It is a table, with the filters, sorting, paging, column choice and export every
other list has. Two of its filters answer a question the routine itself cannot:

| Filter                        | What it keeps                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Assigned to**               | Routines somebody in your reporting line is assigned to. Only your own downline is offered — they are the people you may assign to in the first place.                                 |
| **Site (of whoever does it)** | Routines whose assignees work at that site. A routine belongs to a _department_, and a department can span every plant, so "where is this routine?" is really "where are its people?". |
| **Points at least**           | Routines worth at least that many points.                                                                                                                                              |

### Add someone

Two ways, both needing `users:create`. Either way they have **no access** until you
add them to a group — an account grants an identity, not permission. Their user page
says "Not in any group" until you fix it.

**Users → Invite** asks for a name and an email, and sends them a link to set their
own password. Quickest when you only have their address.

**Users → New user** is the full form: their login username (suggested from the
email, yours to change), job title, employee id, and contact details. It also lets
you **set a password now**:

| You set a password                                                                                                                                                 | You leave it blank                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| They can sign in immediately — but Reportly makes them replace it before they can use anything. A password you know is not a working credential to leave standing. | They are emailed a set-password link, exactly as an invitation does. |

Only the **email** is required. Mobile, WhatsApp/Telegram flags and a Discord handle
are all optional, and all start out **unverified** — you can record them, but only
the person themselves can prove them (see [Verifying your contact
details](#verifying-your-contact-details)).

The **designation** is chosen from a list, not typed — see below.

### Manage the designations

**Designations** (`designations:read`) is the catalogue of job titles a user can be
given. Making it a list rather than free text means "Sr. Engineer" and "Senior
Engineer" stop being two jobs, a title can be renamed in one place, and you can see
how many people hold each.

| Task                | Permission            | Notes                                                 |
| ------------------- | --------------------- | ----------------------------------------------------- |
| New designation     | `designations:create` |                                                       |
| Rename              | `designations:update` | Corrects **everybody** holding it — they point at it. |
| Retire (deactivate) | `designations:update` | Stops being offered; people who hold it keep it.      |
| Delete              | `designations:delete` | Refused while anybody holds it. Retire it instead.    |

The list shows a **head-count** beside each title. That count is the thing to look
at before you change one: a rename touches all of them at once, and a title cannot be
deleted while it is in use — retire it, and the people who hold it keep it while
nobody new is offered it.

A user's designation is then picked from this list on their profile. A retired title
is not offered to anybody new, but if someone already holds one it still shows on
their profile (marked "retired"), so saving their profile never quietly strips it.

### Build the department tree

**Departments** (`departments:read`) shows the org structure of the company picked in
the top bar. Departments do **not** grant access — groups do. This is the shape of
the organisation, not who may see what.

| Task                 | Permission           | Notes                                             |
| -------------------- | -------------------- | ------------------------------------------------- |
| New department       | `departments:create` | Optionally under a parent, forming the tree.      |
| Rename / move        | `departments:update` | It cannot be moved under one of its own children. |
| Deactivate           | `departments:update` | Reversible; members and sub-departments intact.   |
| Delete               | `departments:delete` | Refused while it has sub-departments or members.  |
| Set members and HODs | `departments:assign` | Admin-only; Manager does not hold this.           |

**Prefer deactivating.** Deleting is refused while a department still has people or
sub-departments in it, so a whole branch of the org chart can never vanish by
accident.

### Saving keeps you where you are

Saving an edit stays on the page, with a brief confirmation in the corner — you can
carry on making changes instead of finding your way back. Creating something opens
what you just made, which is where the next edit happens anyway. Deleting is the
one that returns you to the list, because what you were looking at is gone.

The confirmations are yours to configure under **Your account → Preferences**:
whether they appear at all, which corner they sit in, and how long they stay
(including "until I dismiss it"). An administrator sets the default for everybody;
anybody may override it for themselves.

### Tables page from the top as well as the bottom

Every table carries the same paging controls above the rows and below them, so on a
full page you do not have to scroll to the end to reach "next".

### How departments are shown when you pick one

Anywhere you choose a department — filing an entry, creating a routine, asking for
a shift change, filtering the journal — the list shows the department's name with a
smaller line under it saying where that department sits:

| The second line says   | When you see it                                                        |
| ---------------------- | ---------------------------------------------------------------------- |
| Its parent departments | The department is nested, e.g. `Engineering › Platform` under Backend. |
| The company            | The list covers more than one company (only your own profile does).    |

Two things follow from names being unique **per company**:

- Inside one company a name can never repeat, so a department is always
  identifiable by name alone; the parents are there to save you opening the tree.
- Across companies it easily repeats. If you work for two companies you may be in a
  "Maintenance" at each.

Forms that create something — an entry, a routine, a shift change — offer only the
departments of the company picked in the top bar, because that is the company the
new thing belongs to. If a department you expect is missing, switch company in the
top bar. **Users → _the person_ → Departments** is the one place that lists
memberships across every company, and there each one names its company.

These lists are searchable: type any part of the name, a parent, or the company.

### Set the reporting line

Open a department and use **Members** (`departments:assign`). Tick who is in it, and
for each person set three things:

| Field          | What it means                                                                |
| -------------- | ---------------------------------------------------------------------------- |
| **Rank**       | Head of Department, team leader, or member. A label — see the warning below. |
| **Reports to** | Who is above them. **This is the hierarchy.**                                |
| **Sites**      | Which locations their membership covers. Select none to mean _all_ of them.  |
| **Central**    | They travel between sites — rostered on the department's central rota.       |

Rank, reporting line, sites and **Central** can all be set from either end: the
department's **Members** tab, or **Users → _the person_ → Departments**. Whichever
page you are already on is the right one.

So a typical shape is: the boss in Management reporting to nobody; the HOD of
Engineering reporting **up to the boss** — a person in a _different_ department, which
is allowed and expected; the team leaders reporting to the HOD; and the juniors
reporting to their leader. One leader can cover several sites; pick more than one.

A person's **downline** is everyone below them in that line, at any depth — not just
their direct reports. Open **Users → _the person_ → Departments** to see it drawn out,
along with who they report to in each department.

### Read the organisation chart

**Organisation** (`departments:read`) draws the whole reporting line for the company
picked in the top bar.

|                   |                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| **Move around**   | Drag to pan, scroll to zoom, or use the buttons. **Fit to screen** scales the whole chart to the window. |
| **Fold a branch** | Click the badge under a card. The number on it is how many people are beneath — folded or not.           |
| **Department**    | Show only one department. People whose manager sits outside it are still drawn, from their own top.      |
| **Focus on**      | Show one person and everyone beneath them — their downline, drawn.                                       |
| **Highlight**     | Ring everyone matching a name, job title or email, without hiding the rest.                              |
| **Export**        | PDF, a self-contained HTML file, or CSV.                                                                 |

Exports carry whatever the **filters** are showing — that is part of what you meant.
They ignore which branches you happened to have **folded**, because folding is a way
of looking at the chart, not a claim that those people left.

- **PDF** opens your browser's print dialog; choose _Save as PDF_.
- **HTML** is one file with the pictures embedded, so it opens for somebody who has
  no Reportly account.
- **CSV** is one row per person, with their manager, depth and head-count — the
  questions a picture cannot answer.

> This chart is drawn from the very edges that decide who may see whose reports. If
> it looks wrong here, the access it implies is wrong too — which is the point of
> being able to look at it.

> **The reporting line is what decides who can see whose reports — the rank does
> not.** Making somebody a "Head of Department" grants them nothing on its own; what
> they can see comes from who reports to them. Check the downline on their user page
> after you change anything: that list _is_ the answer.

Reportly refuses a line that loops back on itself, or that names a manager who is not
in this company's org. Removing somebody who had people under them leaves those people
reporting to nobody rather than to a ghost — reassign them.

### Add, rename or retire a location

Open the company (**Companies → _name_**). Names are unique within a company.

| Task       | Permission         | Notes                                  |
| ---------- | ------------------ | -------------------------------------- |
| Add        | `locations:create` |                                        |
| Rename     | `locations:update` | Group scopes follow the rename.        |
| Deactivate | `locations:update` | Reversible. Group scopes are kept.     |
| Delete     | `locations:delete` | Refused while a group is scoped to it. |

**Prefer deactivating.** Deleting a location removes it from every group scoped to
it, which changes what their members can see. Reportly refuses the delete and names
those groups; you can then remove the scope deliberately, or deactivate instead.

Each company has a `Remote` location, created with it, for people without an
office. It can be renamed, but never deleted or deactivated.

---

## Company administrator

Someone whose groups grant the update and delete permissions for a company and the
things inside it.

### Grant someone access

Access comes only from groups. To give a user permissions:

1. **Groups → _the group_ → Members** (`groups:assign`).
2. Tick the user, then **Save changes**.

The picker submits everyone who is ticked, not just your change — the server
replaces the whole membership. That is why it loads the current members first.

### Build a group

A group needs three things:

1. **Roles** — what its members may do.
2. **Companies** — where those permissions apply.
3. **Locations** — optionally narrower still. A location must belong to one of the
   group's companies, so assign the companies first; until then, the locations of
   other companies are not offered.

Then add **Members**.

### Retire a company

Open it (**Companies → _name_**).

**Deactivate** (`companies:update`) closes it for business. From that moment:

- **Nothing new can be filed into it and nothing in it can be changed** — journal
  entries, tasks, assets, devices, downtime, routines, shifts, locations,
  departments, categories, tags, parts. The API refuses the write and says why, for
  everybody including a superadmin. An exemption would make "deactivated" mean
  "deactivated unless somebody important is typing".
- **Everything stays readable.** Lists, exports, analytics and reports carry on. The
  point is to stop the company accruing work, not to hide the work already in it.
- **The app says so.** The company switcher labels it _(deactivated)_, and a banner
  sits at the top of every screen while it is the active company.
- Its locations and every group scoped to it are untouched; nothing is deleted.

**Reactivate** puts it straight back. That is deliberately _not_ one of the things
deactivation blocks — otherwise a company could never be turned back on.

**Delete** (`companies:delete`) destroys its locations, and every group scoped to
it loses that scope — which changes what their members can see. Reportly refuses
the delete and names what it would take, unless you confirm that explicitly. A
company that has only its `Remote` location and no groups deletes cleanly.

### Delete a group

**Groups → _the group_ → Delete group** (`groups:delete`).

A group holds no data of its own. Deleting it revokes its members' access and
destroys nothing — the users, roles, companies and locations it points at all
survive. The confirmation says how many people lose access.

System groups cannot be deleted.

### Build a role

**Roles & permissions → New role** (`roles:create`). Tick the permissions it grants,
grouped by the resource they name.

The seeded roles are marked **System** and cannot be edited or deleted: a role
defines what a permission set _means_, so changing one would silently re-grant
every group holding it. **Clone** one (`roles:clone`) to get an editable copy.

Editing a custom role changes what every group holding it may do, retroactively —
the editor names those groups before you save. Deleting a role is refused while any
group still holds it.

### Make two-factor compulsory

Three ways, and they add up rather than cancelling out — if any of them applies to
somebody, they must enrol:

| Where                                        | What it covers                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **A group** (Groups → _the group_ → Members) | Everybody in that group. The usual choice: "everybody in Admins enrols".                                                                   |
| **Settings → Authentication**                | The whole installation, and separately superadmins, who otherwise sit outside a rule that binds everyone else.                             |
| **A company's own setting**                  | Everybody working in that company. A company can require it where the installation does not; it cannot waive one the installation has set. |

**Nobody is locked out.** Somebody who has not enrolled keeps working normally until
the grace period runs out — the app shows a banner counting down — and after that the
only screen they can reach is the one that sets two-factor up. The way out is always
forward.

**The grace period** is in Settings → Authentication (seven days by default; zero
makes it bite immediately). It counts from when the requirement first applied _to
that person_, so somebody added to a required group later gets their own days rather
than a deadline that expired before they arrived.

If somebody loses their phone, an administrator with `users:manage-2fa` resets their
enrolment from their user page; they are then asked to set it up again.

### Turn the shipped roles off

**Settings → Access** (`settings:manage`). If you describe your access from
scratch, the fifty roles that ship with Reportly are noise. Switching them off hides
them from the pickers and stops them granting anything.

**Nothing is deleted.** Each group keeps the roles it holds, so switching them back on
restores every grant exactly as it was. Before you flick it, the panel says how many
people would lose _all_ access — those whose groups hold system roles and nothing
else. Superadmins are unaffected, so the switch can always be undone.

### See what a group actually grants

**Groups → _the group_ → Effective permissions.** A group with four roles answers
"what may these people do?" four times over, with overlaps. This tab is the union —
every permission the group grants, arranged the way the role editor arranges them,
and it is what the server checks when somebody in the group makes a request. Hover a
permission to see which role brought it.

On the **Roles** tab, what the group already holds sits at the top under
**Selected**, with the count beside the search box, and each role shows its
permission count and whether it is a **System** role or one of yours.

### Find a role, a group or a person quickly

The Roles, Groups, Designations and Users lists each carry a **search box** and a
two-way **toggle** in the toolbar — System / Custom on roles and groups, Active /
Retired on job titles and people. They are the filters that get used constantly, so
they sit in the open rather than behind **Filters**, which still holds everything
else.

### Copy a system group

The seeded groups are marked **System**. Their roles and scope are fixed, because
changing them would silently change what everyone holding them can do.

To start from one, open it and use **Clone** on the groups list. You get an
editable copy of its roles and scope. Members are not copied.

### See where someone is signed in

**Users → _the user_ → Sessions** (`users:read`) lists their live sessions, with
the device and address each came from. **Sign out** (`users:update`) revokes one,
signing out that device only.

### Deactivate a user

**Users → _the user_ → Deactivate** (`users:update`). Every session they hold is
revoked immediately, and they cannot sign in again even with the correct
password. Nothing is deleted, and you can reactivate them later.

The last active superadmin cannot be deactivated — the API refuses, and says so.

### Let somebody back in after too many failed sign-ins

**Users → _the user_ → Security → Release** (`users:manage-2fa`).

Too many failed sign-ins in a row and the account is held for a few minutes. The
count is per person **and** per address, and only failures count — so a colleague
fumbling their password on the same office connection cannot refuse your correct
one, and signing in successfully clears it.

The **Users** list shows a **Locked out** badge in the _Sign-in_ column, so you can
see who is stuck without opening anybody. Both the badge and the card read the live
counter, so they are never a stale copy of a lock that has already expired.

Releasing is written to the audit trail. Treat it the way you treat a two-factor
reset: somebody who talks you into it has bought themselves another run of guesses
at that account.

### Remove someone's two-factor

**Users → _the user_ → Security → Remove** (`users:manage-2fa`).

This is the **only** way back for someone who has lost both their authenticator and
their recovery codes: the screen that turns two-factor off asks for a code from the
device they no longer have.

It is the one thing you may do to somebody else's second factor. You cannot turn it
**on** for them — that needs the authenticator in their own hands — and you cannot
read it.

Removing it signs that account out everywhere, is written to the audit trail, and
emails the person that it happened.

> **Treat a reset request as an identity check, not a chore.** After this, the
> account is protected by its password alone. Anyone who can talk you into doing it
> has got past their second factor without ever touching it — which is exactly why
> `users:manage-2fa` is a separate permission, held by Superadmin and Admin but not
> Manager.

If the person locked out is the **only superadmin**, this screen cannot help — they
are the one who cannot sign in, and nobody is left to click it. That case is
recovered from the command line: see [Operations](operations.md#two-factor-lockout).

---

## Superadmin

Bypasses every permission check, and is the only role that can see every company.

### The settings screens

See [Configuration](configuration.md). Everything applies immediately.

### Investigating something

Reportly gives you one thread to pull. Every request has an id, and it appears
everywhere that request touched.

1. **Audit → _the event_ → Details** shows who did what, and the **request id**.
2. **Logs → Search**, filter on that request id, and you have every log line the
   request produced — including anything the browser reported.
3. **_The record_ → History** shows the field-level before and after for any user,
   group or company.

The audit trail is append-only. Nothing in the application can edit or delete it.

### Watching the system live

**Settings → Debug** turns on verbose logging, with query counts per request, for a
duration you choose. Then **Logs → Live tail** streams lines as they arrive; pause
it whenever you like. It stops polling on its own when the tab is in the
background.

Debug switches itself off when the time is up.

### Deciding what the organisation is told

**Settings → Notifications** is a grid of every event against every channel. It is
both the default and the **ceiling**: a person's own preferences move inside it and
can never switch on something you have switched off. See
[Notifications](user/notifications.md).

### Switching an optional module on

**Cartridges** is off until a company turns it on, and while it is off it does not
exist for that company — the navigation hides it and its routes answer 404 rather
than 403, so nobody learns the feature is there. Switch it on per company in
Settings. See [Cartridges](user/cartridges.md).

Queue administration is gated by the server rather than by a permission: unless
the installation runs with `QUEUE_ADMIN` set, those routes are never mounted.

### Backups

**Backups** schedules a database dump and a copy of the attachment store, each
with its own retention. Retention counts copies, not days.

**Test a restore before you need one.** A backup nobody has restored is a
hypothesis. See [Operations](operations.md).

### Resetting the superadmin password

There is no way to do this in the app. On the server:

```bash
pnpm --filter @reportly/api cli reset-superadmin
```

It prints a new random password once. See [Operations](operations.md).
