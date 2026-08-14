# Overview

Reportly is a self-hosted application for departments — IT first — to record
technical work across multiple companies and locations.

## What is in it

| Area                       | What it does                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The journal**            | Issues and work logs, with severity, status, category, department tags, attachments, comments and handover. The core record.                               |
| **Scoring and points**     | Every finished entry is scored twice — a split by the author, a review by their manager — and the points roll up the reporting line.                       |
| **Downtime**               | How long production was stopped, recorded separately from how long a person worked, and only for the asset and device types that can actually stop a line. |
| **Tasks**                  | Work intended, as opposed to work recorded. Completing one leads into a journal entry.                                                                     |
| **Shifts**                 | A per-department calendar, with colleague swaps that route to the right approver.                                                                          |
| **Routines**               | Recurring duties — the weekly check, the monthly clean — with compliance tracking and month-end awards.                                                    |
| **Reports**                | Saved views over the journal, printable and exportable.                                                                                                    |
| **Analytics and insights** | MTBF, MTTR and availability rolled up through the asset tree; charts for the shape of the work.                                                            |
| **Assets and devices**     | The physical tree — site, line, station — plus the devices attached to it.                                                                                 |
| **Cartridges**             | An optional module for refillable parts. Off by default.                                                                                                   |
| **Notifications**          | Six channels, an administrator's matrix, and per-person preferences inside it.                                                                             |
| **Operations**             | Backups, an append-only audit trail, structured logs in their own database, and queue administration.                                                      |

## The access model

Four concepts, in the order they matter:

- **Permissions** are strings like `users:read` or `settings:manage`. They are the
  only thing the API checks.
- **Roles** are named bundles of permissions. They are fixed: a role defines what a
  permission set _means_, so editing one would silently re-grant every group that
  holds it. Reportly seeds Superadmin, Admin, Manager and Member.
- **Groups** hold roles, and the companies and locations those roles apply to.
  Groups are the thing you compose.
- **Users** get their access entirely from the groups they belong to.

A brand-new user therefore has **no access at all** until an administrator adds
them to a group. That is deliberate: an invitation grants an identity, not
permission.

A **superadmin** bypasses every permission check. That is the only exception.

### Companies, locations and departments

Every company owns its locations, and a `Remote` location is created with the
company so people without an office still have somewhere to report from. It cannot
be deleted.

A group may span several companies. Its locations must belong to one of them — the
API refuses any other, and the group editor only offers the valid ones.

**Departments** belong to a company too, and nest into a tree: `Engineering` may sit
above `Backend`. They are the org structure, not the access model — a department
grants nobody anything. A person may belong to several departments, across
companies.

Keep the two apart in your head:

|                 | Grants access                          | Describes the organisation |
| --------------- | -------------------------------------- | -------------------------- |
| **Groups**      | yes — this is the only thing that does | no                         |
| **Departments** | no                                     | yes                        |

### The reporting line

Inside a department, each person's membership records three things:

- a **rank** — Head of Department, team leader, or member;
- who they **report to**;
- the **sites** their membership covers (none means all of them).

```
Management        Boss            reports to nobody
  └─ Engineering  Asha  (HOD)     reports to Boss      ← across departments
       ├─ Ravi          (lead)    reports to Asha, Mumbai
       │    └─ 6 juniors          report to Ravi
       └─ Neha          (lead)    reports to Asha, Pune + Delhi
            └─ 4 juniors          report to Neha
```

Two things about that are deliberate:

**"Reports to" may cross departments.** A Head of Engineering reports up into
Management, not sideways into their own team. The edge only has to stay inside the
company.

**The reporting line is the hierarchy — the rank is only a label.** A person's
**downline** is everyone below them in that line, at any depth: the boss above sees
Asha, and Ravi, and Ravi's juniors. That set is what report visibility will be
computed from, so it is walked from the stored edges and never guessed at from a job
title or from where somebody sits in the department tree. A title and a chain that
disagreed would be a bug that handed the wrong person somebody's entries.

Reportly refuses an edge that loops, or that names somebody outside the company.

### Identity and contact

A user signs in with **either their email or their username** — both are unique, and
the username is required.

Beside their email, a person may have a mobile number, flags saying that number is
also on **WhatsApp** or **Telegram**, and a **Discord** handle (its own address —
Discord cannot be reached by a phone number). Only the email is required.

Each of these is **verified separately**, by a one-time code sent to it, and only by
the person who holds it. An administrator can record someone's mobile number; they
cannot vouch for it, because vouching proves nothing.

## Architecture

```
browser ──► web (React, Vite)
              │  x-request-id, X-Company-Id, session cookie
              ▼
            api (Fastify)
              ├─► Postgres  reportly        application data
              ├─► Postgres  reportly_logs   logs, separate so volume never
              │                             affects the app
              ├─► Redis                     sessions, caches, rate limits, queue
              ├─► SMTP                      invitations, password resets, codes
              └─► Twilio / Telegram /       verification codes for the other
                  Discord (optional)        contact channels
```

Three packages in one repository:

| Package           | What                                                 |
| ----------------- | ---------------------------------------------------- |
| `apps/api`        | Fastify HTTP API, jobs, migrations, CLI              |
| `apps/web`        | React single-page app                                |
| `packages/shared` | Zod schemas, permissions, `can()`, settings registry |

`@reportly/shared` is the single source of truth for anything both sides need.
Neither re-declares a type, a permission or a validation rule.

## Things worth knowing up front

**One request id traces everything.** The browser generates `x-request-id`; the API
carries it through background jobs and into every log line, including errors
reported back from the browser. The audit trail records it too, so you can pivot
from "who changed this record" to "everything that happened during that request".

**Settings apply without a restart.** Password policy, session lifetime, log sinks
and levels, and SSO providers are all runtime settings. Saving one reloads the
affected subsystem in place.

**Debug mode always expires.** It cannot be left on by accident.

**The audit trail is append-only.** The API exposes no way to edit or delete it.

**The points ledger is frozen.** Points are written once when work is scored and
never recomputed. A correction is a compensating entry, not an edit — so changing
a setting today can never rewrite what somebody earned last quarter.

**An optional module that is switched off answers 404, not 403.** A company that
does not use a feature should not learn that it exists. The navigation hides it,
and every route behind it denies knowledge of itself.

**The sidebar never offers a page the API would refuse.** Navigation, route
guards and inline checks all call the same shared `can()` that the API enforces
with, so the UI and the API cannot drift apart about who sees what.

## Next

- [Worked examples](examples.md) — an IT department, feature by feature
- [Architecture](architecture.md) — the pieces, and a request end to end
- [Installation](installation.md) — get it running
- [Your first day](ops/first-day.md) — setting it up for a real team
- [Deploying on Ubuntu](ops/deployment-ubuntu.md) — a server, start to finish
- [Configuration](configuration.md) — what each setting does
- [User guide](user-guide.md) — using it, per access level
- [Operations](operations.md) — backups, retention, troubleshooting
