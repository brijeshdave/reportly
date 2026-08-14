---
layout: home

hero:
  name: Reportly
  text: Technical journalling for departments
  tagline: Your team records what broke, what they fixed, and how long the line was down. Reportly turns that into a reviewable record, a score for the people doing the work, and the reliability figures management asks for. Self-hosted, across multiple companies and locations.
  actions:
    - theme: brand
      text: What Reportly is
      link: /overview
    - theme: alt
      text: Install it
      link: /installation
    - theme: alt
      text: View on GitHub
      link: https://github.com/brijeshdave/reportly

features:
  - title: The journal
    details: Issues and work logs, with the asset, the site, a category and the department's own tags. Attachments, a conversation that stays open after the record locks, and handover when a shift ends with something unfinished.
    link: /reporting
  - title: Scoring two people agree on
    details: An entry is scored by its author and again by a reviewer, who may override in either direction. Points feed a leaderboard scoped to your own reporting line, and every change is on the record.
    link: /reporting
  - title: The figures management asks for
    details: MTBF, MTTR and availability rolled up through the asset tree, saved report views over the journal, and charts for the shape of the work — each one readable as a table.
    link: /user/insights
  - title: Work that recurs
    details: Shifts with a per-department calendar and colleague swaps that route to the right approver. Routines — the weekly check, the monthly clean — with compliance tracking.
    link: /user/shifts
  - title: Access that is a group, not a checkbox
    details: Groups hold roles and the companies and locations those roles apply to. A new user has no access until you add them to one — an invitation grants an identity, not permission.
    link: /overview
  - title: Operations you can run
    details: Scheduled database and file backups with a restore path, an append-only audit trail, and structured logs in their own database with per-feature levels.
    link: /operations
---

## Where to start

These pages are standalone: everything an operator needs to install, configure and
run Reportly, and everything a user needs to work in it.

### If you use Reportly

| Page                                     | For                                                     |
| ---------------------------------------- | ------------------------------------------------------- |
| [Overview](overview.md)                  | What Reportly is, and how the pieces fit together       |
| [Worked examples](examples.md)           | An IT department through a fortnight of ordinary work   |
| [User guide](user-guide.md)              | Task-oriented guides per access level                   |
| [The Journal](reporting.md)              | Filing, scoring, statuses, handover, points             |
| [Insights](user/insights.md)             | The charts, and how to read them without being misled   |
| [Notifications](user/notifications.md)   | The bell, choosing what you receive, and the channels   |
| [Shifts](user/shifts.md)                 | The calendar, requesting a change, approving one        |
| [Routines](user/routines.md)             | Recurring work, logging it, compliance, points          |
| [Cartridges](user/cartridges.md)         | Refillable parts: the lifecycle, the points, the switch |
| [Import & export](user/import-export.md) | Loading and extracting every master list                |
| [FAQ](user/faq.md)                       | The questions people actually ask                       |

### If you run the server

| Page                                              | For                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| [Deploying on Ubuntu](ops/deployment-ubuntu.md)   | A production server, start to finish                              |
| [Your first day](ops/first-day.md)                | From "it is running" to a team filing real work                   |
| [Scaling](ops/scaling.md)                         | How it grows, what moves first, and where the ceiling is          |
| [Installation](installation.md)                   | Docker Compose, Kubernetes, or bare Node                          |
| [Configuration](configuration.md)                 | Every settings screen, explained                                  |
| [Operations](operations.md)                       | Backups, retention, troubleshooting, the CLI, locked-out accounts |
| [Queues](ops/queues.md)                           | Background jobs: what is stuck, retrying it, and the env switch   |
| [Environment reference](reference/environment.md) | Every environment variable, generated from its validation schema  |

### If you change the code

| Page                                            | For                                                 |
| ----------------------------------------------- | --------------------------------------------------- |
| [Architecture](architecture.md)                 | The pieces, a request end to end, the layering rule |
| [How the code is organised](dev/code-method.md) | The conventions, and why each one exists            |
| [Developer FAQ](dev/faq.md)                     | Layout, conventions, testing, releasing             |
| [API](api.md)                                   | The HTTP API, auto-generated from the code          |

## Quickstart

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

docker compose up -d                                # Postgres, Redis, Mailpit
pnpm --filter @reportly/api cli migrate
pnpm --filter @reportly/api cli seed
pnpm --filter @reportly/api cli reset-superadmin     # prints a password, once
pnpm dev
```

Open <http://localhost:5173> and sign in as `admin@reportly.local` with the
password that was printed. Full instructions, including production, are in
[Installation](installation.md).
