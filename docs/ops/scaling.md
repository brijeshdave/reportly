# Scaling

How Reportly grows, what has to move first, and where the ceiling actually is.

::: warning No numbers here are promises
This page contains no "supports N users" figure, because Reportly has not been
load-tested and inventing one would be worse than saying nothing. What follows is
what the architecture permits, which parts are safe to run several of, and what to
measure on your own hardware. Measure before you scale — the usual answer is one
missing index, not another server.
:::

## Start by knowing the shape of the load

Reportly is not a high-traffic application. A department of fifty files perhaps a
few hundred journal entries a week, and reads them far more often than it writes
them. The load that actually grows is not the writing:

- **Logs**, which are written on every request and outnumber everything else.
- **Reports and analytics**, which read across the whole history rather than a
  page of it.
- **Attachments**, which grow without bound and never shrink.

Those are the three that need a plan. The journal itself is small.

## One box goes a long way

The default deployment — API, web, Postgres, Redis on one machine — is the right
answer for a single department and probably for a company. Before adding
machines:

1. **Give Postgres more memory.** It is almost always the first real constraint,
   and it is cheaper to raise than to shard.
2. **Check `cli doctor`** and the queue screens. A backlog is a worker problem,
   not a capacity problem.
3. **Turn debug mode off.** It logs every query count and is meant to expire.
4. **Look at the slow query log** before concluding you need another server.

## The API scales sideways

The API is **stateless**. Sessions live in Redis rather than in memory, which is
the property that makes instances interchangeable: any request can be served by
any instance, and losing one costs the requests in flight rather than everybody's
login.

To run several:

- Put them behind a load balancer. **No sticky sessions needed.**
- Set `TRUST_PROXY` so per-IP rate limits and audit records show the caller
  rather than your load balancer. Getting this wrong turns a per-user rate limit
  into a global one.
- Point every instance at the same Postgres and the same Redis.

::: danger Run the migrations once, not once per instance
The migration step is a separate service that the API waits on, not something
each instance does at boot. Several instances migrating the same database
simultaneously is a bad afternoon.
:::

## Workers scale separately from the API

Queue workers run in the API process. That is right until it isn't: a large
`pg_dump` or a burst of notifications competes with requests for the same event
loop.

When it starts to hurt, run additional instances dedicated to draining queues and
keep them off the load balancer. BullMQ distributes across all consumers of a
queue, so nothing needs to know how many there are.

The queues to watch first are `notifications` — the one with a fan-out — and
`backup`, the one with the heaviest single job.

## The database is the ceiling

Postgres is where the real limit sits, and the honest ordering of what to do about
it:

1. **Indexes.** Almost every slow page here has been a missing index rather than a
   missing server.
2. **More memory,** then faster disks.
3. **A read replica** for the reporting and analytics load, which is the read-heavy
   half and tolerates a little staleness. The application does not route to
   replicas today — this would need work.
4. **Partitioning the journal by date**, if history ever outgrows the box. Nothing
   in the schema prevents it; nothing implements it either.

Reportly is single-tenant per deployment. Multiple companies inside one
installation share a database, scoped by `companyId` on every table and enforced
in the repositories. That is a data-isolation boundary, **not** a performance one:
a hundred companies in one installation is a hundred companies' load on one
database.

## Logs will outgrow everything else

They already have their own database, which is the point — their volume never
competes with the application for connections or vacuum.

- Set **retention** deliberately in Settings → Logging. The default is not a
  policy for your organisation.
- Turn **per-feature levels** down in production. They exist so one noisy area can
  be turned up without drowning in the rest.
- When the log database outgrows the box, give it its own server. It is a
  connection string; nothing else changes.
- The **file sink** is for shipping to a collector. Every line is one JSON object
  with stable fields — see [Architecture](../architecture.md#the-log-contract) —
  so Loki, ELK or Vector can consume it without a parser you have to maintain.

## Attachments grow and never shrink

Local disk is fine to start and becomes the thing that pins you to one machine —
several API instances cannot share a local directory.

- Keep `STORAGE_LOCAL_DIR` on a volume that survives redeployment. It is not
  inside the container.
- Move to object storage before you add API instances, not after. `cli
storage:migrate` moves what is already there, and takes `--dry-run`.
- Attachment size limits are a setting, and worth setting deliberately before
  somebody uploads a video of a broken machine.

## Redis

Small, and mostly boring. Sessions, cached settings, rate-limit windows and the
queues. It needs memory in proportion to the number of signed-in users and the
depth of the queues, both of which are modest.

Two things worth knowing: **it is not optional** — sessions and queues both depend
on it, so losing Redis signs everybody out and stalls the workers — and its
**database index in the URL is honoured**, which is how several stacks share one
server without colliding.

## What to watch

| Signal                              | Where                     | What it usually means                                   |
| ----------------------------------- | ------------------------- | ------------------------------------------------------- |
| Slow pages                          | Debug mode's query counts | A missing index, or a query per row                     |
| A growing queue                     | Queues screen             | Workers starved of CPU, or a failing job retrying       |
| The log database outgrowing the app | Disk                      | Retention is unset, or a level is too verbose           |
| Failed backups                      | Backups screen            | Disk, or `pg_dump` unavailable to the container         |
| Rate limits hitting real users      | Logs, filtered by feature | `TRUST_PROXY` wrong — every caller looks like the proxy |

## If you do load-test it

Please share the numbers. This page would be better with them, and the honest
version of it stays vague until somebody measures. Worthwhile shapes: concurrent
readers on the journal list, a report over a full financial year, and a
notification fan-out to a few hundred recipients.
