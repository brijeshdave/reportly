# Configuration

Two kinds of configuration, and the difference matters:

- **Environment variables** are infrastructure. They are read once at startup and
  need a restart to change. See the
  [environment reference](reference/environment.md).
- **Settings** are behaviour. They live in the database, are edited in the app, and
  **apply immediately** — the API reloads the affected subsystem in place.

Everything below is a setting, found under **Settings** in the sidebar. Reading
them needs `settings:read`; changing them needs `settings:manage`.

Some settings are also **per-user**: an administrator sets the organisation
default, and each user may override it for themselves under **Your account →
Preferences**.

---

## Authentication

### Password policy (`auth.passwordPolicy`)

| Field              | Meaning                                                               |
| ------------------ | --------------------------------------------------------------------- |
| `minLength`        | Minimum characters (8–128).                                           |
| `requireUppercase` | At least one uppercase letter.                                        |
| `requireNumber`    | At least one digit.                                                   |
| `requireSymbol`    | At least one character that is not a letter, digit or space.          |
| `expiryDays`       | Force a change after this many days. `0` (the default) never expires. |
| `reuseCount`       | Reject a password matching the last N. `0` disables the check.        |

The rules are enforced by the server on sign-up, password reset, password change
and invitation acceptance. The sign-up form shows the same rules, read from the
same place, so the two cannot disagree.

**Sign-in is exempt from the string rules.** Tightening the policy must not lock
out an account whose existing password no longer complies. Those users are asked
for a new password the next time they change one.

### Reuse

Reportly stores a hash of each password a user has held. A new password is rejected
if it matches the current one or any of the previous `reuseCount - 1`. The default
is **3**, so a user cannot cycle back to a recent password.

Only hashes are kept, never the passwords. Deleting a user deletes their history.

### Expiry

With `expiryDays` above zero, a password older than that is expired. The user can
still sign in, but **every endpoint except their own account refuses them** until
they set a new one — the web app redirects them straight to the change-password
screen and says why.

Expiry is off by default. A user whose password predates this feature has no
recorded history and is treated as current, rather than locked out of an account
that otherwise works.

### Sessions (`auth.session`)

`expiresInSeconds` is how long a session lasts. `updateAgeSeconds` is how often an
active session is extended — set it lower than the expiry, or sessions will end
mid-use.

### Sign-in rate limit (`auth.rateLimit`)

`signInMax` attempts per `signInWindowSeconds`, per IP. The default of 5 per minute
stops credential stuffing without troubling anyone who mistypes a password.

### Invitations (`auth.invite`)

`expiryHours` — how long an invitation link stays valid.

---

## Contact channels

A person can be reached on their email, their mobile (SMS), WhatsApp or Telegram on
that number, and Discord. Each is proved by a one-time code sent to it, and only by
the person who holds it.

**Email needs no configuration** — Reportly already has a mailer, so email
verification works the moment you install it. Every other channel needs a provider,
and until one is configured that channel reports itself **Unavailable** rather than
pretending to send a code into the void.

### Providers (`channels.providers`)

**Settings → Channels.** Blank means "not configured".

| Setting              | Channel it enables | Where it comes from                             |
| -------------------- | ------------------ | ----------------------------------------------- |
| `twilioAccountSid`   | SMS + WhatsApp     | Twilio console (or an API-compatible gateway)   |
| `twilioAuthToken`    | SMS + WhatsApp     | Twilio console                                  |
| `twilioSmsFrom`      | SMS                | A Twilio number, e.g. `+15551234567`            |
| `twilioWhatsappFrom` | WhatsApp           | A WhatsApp sender, e.g. `whatsapp:+14155238886` |
| `telegramBotToken`   | Telegram           | `@BotFather`                                    |
| `discordBotToken`    | Discord            | Discord developer portal                        |

Two of these have a catch that is not Reportly's to fix:

- **Telegram** bots cannot message a stranger. The person must have started a chat
  with your bot first, or Telegram refuses the send.
- **Discord** cannot be reached by phone number at all — that is why a Discord handle
  is its own field on a user, not a flag on their mobile. The bot must also share a
  server with them to open a DM.

Secrets are stored in the settings table, as SSO client secrets already are.

### Verification codes (`channels.verification`)

| Setting                 | Default | What it does                             |
| ----------------------- | ------- | ---------------------------------------- |
| `codeLength`            | 6       | Digits in the code.                      |
| `expiryMinutes`         | 10      | How long a code lives.                   |
| `maxAttempts`           | 5       | Wrong guesses before the code is burned. |
| `resendCooldownSeconds` | 60      | How soon another code may be asked for.  |

The defaults are what make a six-digit secret safe: it is random, stored only as a
hash, short-lived, burned after a few wrong guesses, and cannot be re-requested in a
loop. Loosening several of them at once is how a six-digit code becomes guessable.

Changing an address drops its verification — a code sent to an old number proves
nothing about a new one.

---

## Journal setup

**Journal setup** holds the catalogues that make the journal fit your
organisation. Anyone who files an entry reads them; only an administrator changes
them. Each entry can be **retired** rather than deleted, so taking it out of use
never disturbs entries that already reference it.

The tabs carry separate permissions, so they can be delegated independently:
severities and statuses need `journal-config:manage` (they change what recorded
work is worth), while `categories:manage` and `device-types:manage` are each
grantable on their own.

**Tags are not here.** They have `tags:manage` to themselves, so they have a
screen to themselves: **System → Tags**. Somebody who curates the vocabulary
should not have to open a page of catalogues they may not touch to reach it.

### Severities

The ladder of how serious an issue is. Ships seeded, low to high: Informational,
Minor, Moderate, Major, Critical. All editable; add your own.

Severity labels the entry and drives the reliability figures and the reports that
group by it. It does **not** change what the work is worth — see Appraisal below.

### Statuses

The workflow an entry moves through. You name the steps; the engine only needs to
know which of three **groups** each belongs to — **open** (still being worked),
**resolved** (a good ending), or **rejected** (not a real issue) — and whether it
is **terminal** (ends the workflow).

Seeded, deliberately short: Open, Acknowledged, In progress, On hold (open);
Resolved (resolved); Duplicate, Not an issue, Cancelled (rejected). Every extra
status is a choice somebody has to make correctly, and an earlier ladder carried
three different "done" states with no rule for picking between them.

### Categories

What kind of issue, **per department** — Maintenance's categories are its own, and
two departments may each have a "Safety" that means different things. Pick a
department, then add its categories. None are seeded; you build the list that suits
each department.

### Device types

Device types decide, among other things, whether downtime can be recorded against
a device at all — see [Downtime](#downtime).

## Tags (`System → Tags`)

Its own screen, gated on `tags:manage` alone.

Tags are **department-scoped and multi-select**, so each department keeps its own
vocabulary and one team's labels never clutter another's. Category stays
single-select by contrast, because the recurring-issue analytics group by it.

A new tag arrives already coloured — the server picks from a twenty-hue palette,
preferring one the department is not already using — so the common case is type a
name and press Add. The colour is editable for anyone who organises by it.

### Appraisal (`reports.appraisal`)

- **Roll-up factor** (default 0.25) — how much of an entry's points a manager
  earns from their downline: `factor ^ depth`, so a direct report gives their
  manager a quarter, their manager's manager a sixteenth, and so on. Changing it
  is forward-only — points already awarded are frozen and never recomputed.

**How an entry is scored.** It is worth at most **10 points**, shared out among
everyone who worked it, in half-point steps. The author splits that credit; the
reporting manager then reviews it, and where a review exists it is the official
figure. Scoring is blind upward — the person being reviewed sees only their own
split. Re-opening an entry clears its scores and its ledger rows.

Severity is not part of that arithmetic. A graver issue tends to earn more
because the people scoring it judge it so, not because a multiplier is applied.

### Entry grace period (`reports.entry`)

How far back an entry may be dated, in days. An **issue** is judged by when it
_occurred_, so a real issue reported a few days late is fine but an ancient one is
refused; a **work log** is judged by its report date, which is when its points
count. An entry past the grace period is refused, and a superadmin is exempt.

The default (3650 days) effectively disables the limit — lower it to enforce one.

### Points lock (`reports.lock`)

Close a period. An entry whose points-date falls on or before **Locked through**
is frozen: its points cannot be re-scored or rejected. Blank means no lock.
Format `YYYY-MM-DD`.

A status change still re-opens an entry for re-evaluation, and a superadmin can
always override. Re-opening an entry clears its scores and its ledger rows —
points are for finished work.

See [The Journal](reporting.md) for how these feed the points a person earns.

---

## Assets and devices

What reports are filed _against_. These are split by how many there are, and that
split is the whole design — get it wrong and you either lose the structure or spend
your life maintaining a tree.

### Assets (`assets:read` to see, `assets:update` to change)

**Assets → Tree.** The structural few: a plant, its buildings and areas, its lines,
the stations on them. A nested tree, per company, built by hand — so keep it small.

**Assets → Types** is the vocabulary the tree is built from. It ships as a factory's
(Plant, Building, Area, Line, Station) because that is what Reportly was first used
for. They are data, not code: rename them to Ward and Bed and the same tree describes
a hospital.

Names in the tree are deliberately **not** unique — "Station 1" recurs under every
line, and that is correct.

### Devices (`devices:read` to see, `devices:update` to change)

**Devices.** The many: machines, sensors, instruments. A flat, **searchable**
registry — never a tree, because there may be thousands and nobody will file them by
hand.

The load-bearing field is **Lives at**: the asset a device stands at. It is the only
link between the flat registry and the tree, and so the only reason "every issue
under Line 3" also finds the machines on its stations. A device with no asset is
still perfectly usable — it just will not roll up.

### Retiring, not deleting

Both follow the rule the rest of the app uses: anything referenced by a report or a
downtime entry **cannot be deleted**, and the API says what still points at it.
**Retire** it instead — it stops being offered to anyone filing a new report, and the
history that names it keeps its label.

---

## Downtime

**Downtime** (`downtime:read` to see, `downtime:write` to record) has one rule
worth knowing: an entry is raised **from a journal entry** and only against
something that entry is already about, so its scope and its downtime can never
drift apart.

**Downtime is not work time, and the two are recorded separately.** Work time is
how long a person was engaged; downtime is how long production was stopped. They
routinely differ — a machine back in five minutes can still cost an afternoon of
observation — so one number could never mean both.

**Which things can stop production is configured per type.** Every asset type and
every device type carries a "tracks downtime" switch, edited on the type itself
(Assets → Types, and Journal setup → Device types). A PC going down is not a line
stopping, so leaving it off means the journal never asks for a downtime figure
that would be meaningless. Turn it on for the types whose failure actually halts
production.

An entry with no end time is **open**: it lists in **Downtime → Still down**, and it
counts up to _now_ in **Downtime → Totals** rather than reading as zero. Closing it is
an edit on the report — fill the end time in and save.

Everyone who can file a report can record and close downtime on their own (`Member`
holds `downtime:write`); the service further limits it to the report's author and the
people above them in the reporting line.

---

## Attachment storage

Where the files on a report physically live. This is split across the two kinds of
configuration on purpose, and the split is worth understanding before you change
either.

### The backend (environment — needs a restart)

`STORAGE_BACKEND` is `local` or `s3`. See the
[environment reference](reference/environment.md) for every variable.

- **`local`** writes under `STORAGE_LOCAL_DIR`. Fine for one node and for
  development. In containers this **must be a mounted volume** — the image runs on a
  read-only root filesystem, so an unmounted path simply fails to write.
- **`s3`** works with AWS S3, MinIO, Cloudflare R2 and Backblaze B2. Set `S3_BUCKET`
  and `S3_REGION`; add `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true` for anything that
  is not AWS. Omit both key variables to use ambient credentials (an instance role) —
  the right way to run on AWS. Selecting `s3` without a bucket **refuses to start**
  rather than failing on the first upload.

`STORAGE_MAX_UPLOAD_MB` (default 50) is a **hard ceiling**, enforced as the bytes
arrive, that protects the server's memory. It is not the per-organisation limit.

### Switching backends

**Changing `STORAGE_BACKEND` only redirects new uploads.** Every existing file keeps
working from where it is, because each file records its own location rather than
having it derived from the current setting — otherwise flipping this would orphan
everything already uploaded.

To move the existing files, run:

```bash
pnpm --filter @reportly/api cli storage:migrate --dry-run   # say what would move
pnpm --filter @reportly/api cli storage:migrate             # move it
```

It copies, verifies the copy at the destination, repoints the record, and only then
deletes the original — so an interruption leaves two copies, never none. Bytes that
no longer match the checksum taken at upload are **refused and left alone** rather
than copied onward, and the command exits non-zero. It is safe to re-run.

### The limits (`storage.uploads`, under Settings)

| Field              | Default | What it does                                            |
| ------------------ | ------- | ------------------------------------------------------- |
| `maxFileSizeMb`    | 25      | Largest single file. Capped by `STORAGE_MAX_UPLOAD_MB`. |
| `maxFilesPerOwner` | 20      | How many files one report may carry.                    |
| `allowedTypes`     | _(see)_ | Content types accepted. Empty means anything.           |

`allowedTypes` ships as images, PDF, plain text, CSV and Office documents. It is an
**allowlist**: a blocklist would be a promise to have thought of every dangerous file
type, and nobody has. Emptying it accepts anything — a decision to make knowingly.

Every one of these is enforced by the server. The upload form reads the same values
so it can say them up front, but the browser is never what stops an upload.

---

## Single sign-on

**Settings → Single sign-on.** Reportly ships five OIDC providers, all disabled:
Google, Microsoft, Authentik, Auth0 and Clerk.

Each needs a **client ID** and **client secret**. Authentik, Auth0 and Clerk also
need an **issuer URL** — the OIDC discovery document is derived from it. Google and
Microsoft have well-known issuers.

A provider can only be **enabled once every field it needs is filled in**. The
Enable button stays disabled until then, and the API refuses the write anyway.

Once saved, a secret is never shown again. The field displays as empty: leave it
that way to keep the stored secret, or type a new one to rotate it.

Changes apply without a restart, and the sign-in page shows a button for each
enabled provider.

### Registering the redirect URI

Whichever provider you use, register this callback:

```
<BETTER_AUTH_URL>/api/v1/auth/oauth2/callback/<provider-id>
```

For example `https://reportly.example.com/api/v1/auth/oauth2/callback/google`.

### Account linking

An SSO sign-in links to an existing account when the email matches **and that
account's email is verified**. This is deliberate: linking to an unverified address
would let anyone who can create an account at the identity provider take over a
Reportly account by claiming its email.

A user who signs in through SSO and has no groups gets an identity and **no
access**, exactly like an invited user.

---

## Logging

### Sinks (`logging.sinks`)

Three independent destinations: `console`, `file` (a daily-rotating file in
`LOG_DIR`), and `database` (the separate log database). Toggling one takes effect
on the next log line — no restart.

### Levels (`logging.levels`)

`default` applies everywhere. `features` overrides it per feature, e.g. set `auth`
to `debug` while investigating a sign-in problem without drowning in noise from
everything else.

### Retention (`logging.retention`)

`databaseDays` and `fileDays`. A daily job deletes anything older. See
[Operations](operations.md#log-database-sizing) for sizing.

### Buffer (`logging.buffer`)

When `enabled`, log lines are batched through Redis and flushed to the log database
in groups of `batchSize`, instead of being written inline. Turn it on if log writes
are adding latency to requests; leave it off otherwise, since a Redis outage then
costs you the buffered lines.

---

## Debug mode (`debug.mode`)

**Settings → Debug.** When on, every request logs a verbose summary: method, URL,
status, duration, and the number of database queries it ran. Responses carry an
`x-debug: on` header.

Debug **always expires** — you choose 15, 60 or 240 minutes, and it switches itself
off. It cannot be left on by accident.

Request bodies are logged, **except on authentication routes**, so credentials
never reach the log.

Individual users can enable debug for themselves without affecting anyone else;
`debug:toggle` is required either way.

---

## Where the documentation links point

Not a setting — a **build-time environment variable on the web app**,
`VITE_DOCS_URL`.

The account menu and every signed-out screen carry a **Documentation** link.
Unset, it points at the public site. Set it to your own copy when the
installation cannot reach the internet: a closed network sending people to
github.io is sending them nowhere.

Vite substitutes it when the app is built, so changing it means **rebuilding the
web image**, not restarting it. Both links open in a new tab, so nobody loses a
half-filled form to go and read something.

---

## Appearance

### Theme (`ui.theme`)

`palette` is one of eight (aurora, ocean, forest, sunset, ember, orchid, citrus,
graphite). `mode` is `light`, `dark`, or `system`.

Administrators set the organisation default. Users override it under **Your account
→ Preferences**, and their choice is applied before the first paint, so there is no
flash of the wrong theme on reload.

### Tables (`ui.tableDefaults`)

`pageSize` is one of 5, 10, 20, 50 or 100. `density` is `comfortable` or `compact`.

These are defaults. Any table's toolbar can change both for the current view, and
users can set their own defaults in their preferences.

The list of allowed page sizes is defined once and shared: the picker, the
preference form and the API's validation all read the same list, so a size that
appears in the UI is always one the API accepts.

---

## Notifications

Two settings, and the relationship between them is the thing to understand.

### The matrix (`notifications.matrix`)

**Settings → Notifications.** A grid of every event type against every channel,
saying what the organisation sends. It is both the **default** and the **ceiling**:
a user's own preferences move within it, and can never switch on a channel the
matrix has switched off. Turning something off here turns it off for everybody,
whatever their preferences say.

### Delivery (`notifications.delivery`)

How notifications are actually sent — which channels are enabled at all, and the
credentials behind them. A channel with incomplete configuration cannot be
enabled; the form says what is missing.

Individual users choose what they receive under **Your account → Notifications**,
within the ceiling above. See [Notifications](user/notifications.md) for the event
catalogue and what each one means.

---

## Cartridges (`parts.module`)

An **optional module**, off by default and switched on per company.

When it is off, the module does not exist for that company: the navigation entries
are absent and every one of its routes answers **404 rather than 403** — a company
that does not refill cartridges should not learn that the feature exists. Turning
it on reveals the register, the service history and the cartridge reports.

The setting also carries the **failure window** in days: how soon a cartridge
coming back faulty counts against the service it was just given, which is what
triggers the points reversal.

The vocabulary is yours, so the module fits UPS batteries or any other rotable as
well as it fits toner. See [Cartridges](user/cartridges.md).

---

## Backups

**Backups** (`backups:manage`) are configured in two halves, both under
**Settings → Backups**, and both scheduled.

### Database (`backups.database`)

A scheduled `pg_dump` of the application database, with a retention count. The
runtime image ships a Postgres client at or ahead of the server major; `PG_DUMP_CMD`
in the environment points at it when it lives somewhere unusual.

### Files (`backups.files`)

The attachment store, on its own schedule and its own retention.

Retention is a **count of copies kept**, not an age — the oldest is dropped when a
new one lands. A restore path exists for both; see
[Operations](operations.md) for how to actually run one, and test it before you
need it.
