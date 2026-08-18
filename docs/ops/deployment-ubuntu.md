# Deploying on Ubuntu

From a bare Ubuntu 22.04 or 24.04 server to people signing in. Follow it in
order; each section says what it is for, so you can skip what does not apply.

Budget about 30 minutes, most of it waiting for the first image build.

**What you need**

- An Ubuntu server with at least 2 vCPU, 4 GB RAM and 20 GB disk. Reportly itself
  is small; Postgres and the log database grow with use.
- A DNS name pointing at the server, if you want HTTPS (you do).
- An SMTP relay. Without one, nobody can be invited and no password can be reset,
  because both are emails. This is the single most common thing people leave out.

---

## 1. Prepare the server

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone UTC     # timestamps are stored UTC; matching hosts help
```

UTC is a recommendation, not a requirement — Reportly stores every timestamp in
UTC and renders it in the reader's own zone.

### Firewall

Open only what is used. If you are terminating TLS with the bundled Caddy, that
is 80 and 443; port 80 is not optional, because the certificate challenge uses it.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Postgres and Redis are **not** in that list on purpose. They are reachable only on
the compose network, never from outside the machine.

### Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker          # or log out and back in
docker run --rm hello-world
```

The `newgrp` matters: without it the installer below cannot talk to the daemon,
and the error looks like Docker is broken when it is only a stale group list.

---

## 2. Point DNS at the server

Create an `A` record (and `AAAA` if you have IPv6) for the name you will use:

```
reportly.example.com.   A   203.0.113.10
```

Do this **before** the install, and check it has propagated:

```bash
dig +short reportly.example.com
```

Caddy asks Let's Encrypt for a certificate during the first start. If the name
does not yet resolve to this machine, that request fails and you will be rate
limited for a while — so confirm the answer above matches your server's address.

---

## 3. Install

```bash
git clone https://github.com/brijeshdave/reportly.git
cd reportly
scripts/install-ubuntu.sh --host reportly.example.com --email ops@example.com
```

What it does, in order: checks Docker and openssl, generates a database password
and a cookie signing secret, writes `.env` with mode 600, builds both images,
starts the stack, applies migrations, seeds, runs the health check, and prints
the superadmin password **once**.

Copy that password somewhere safe before you close the terminal. It is not
stored anywhere you can read it back; if you lose it, see
[Superadmin password recovery](../operations.md#superadmin-password-recovery).

Without `--host` it serves plain HTTP on port 8080, which is fine for a private
network behind your own TLS but should not face the internet.

### Or do it by hand

Use this if you are not taking the Caddy profile — running behind your own
reverse proxy, for instance.

```bash
cp .env.production.example .env
${EDITOR:-nano} .env          # fill in every CHANGE-ME
scripts/data-dirs.sh          # the bind-mounted backup directory
docker compose -f compose.prod.yaml --profile tls up -d --build
docker compose -f compose.prod.yaml exec api node dist/cli/index.js seed
docker compose -f compose.prod.yaml exec api node dist/cli/index.js reset-superadmin
```

::: danger Do not skip the seed
Migrations are not in that list because they are not yours to remember: the
compose file runs them as a `migrate` service that `api` waits on, so the app
cannot start against a schema it has not migrated.

**Seeding is different.** It writes rows rather than structure — the permissions,
the system roles, the Superadmin group and your superadmin account — and nothing
does it for you. Skip it and the stack comes up looking healthy, then
`reset-superadmin` reports _"Superadmin user not found"_ and there is no way in.

`reset-superadmin` is a separate step again because the seeded account is created
**with no password**; this is what prints one, once.
:::

---

## Where the data lives

Named Docker volumes hold the database, Redis, the uploads and the certificates.
**Backups are the exception** — they are bind mounted to `./data/backups`, so
your existing filesystem backup picks them up and you can copy a dump off the
machine without going through a container.

`scripts/install-ubuntu.sh` creates that directory. Bringing the stack up by
hand? Do it first:

```bash
scripts/data-dirs.sh
```

::: warning Otherwise Docker creates it owned by root
And every backup then fails to write, because the API runs as uid 1000.
:::

`data/backups` holds the dumps in `db/` and the file archives in `files/`. It is
mounted read-only into the Postgres container as well, so a dump can be restored
by hand from in there.

Every other mount has a commented bind-mount alternative in `compose.prod.yaml`
if you want more of the data on the host.

## 4. Set up mail

Invitations and password resets are the only way to onboard anyone, and both are
email. Edit `.env`:

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=reportly@example.com
SMTP_PASS=<relay password>
MAIL_FROM=Reportly <no-reply@example.com>
```

Then apply it and confirm the API can reach the relay:

```bash
docker compose -f compose.prod.yaml up -d api
docker compose -f compose.prod.yaml exec api node dist/cli/index.js doctor
```

`doctor` checks the app database, the log database, Redis, the SMTP connection,
that the attachment store is writable, and that `pg_dump` exists and is new
enough for the server. It is the quickest answer to "is this install healthy",
and it is worth running after any change to `.env`.

---

## 5. First sign-in

Open `https://reportly.example.com` and sign in as the superadmin address with
the printed password.

Do these three things straight away:

1. **Change the superadmin password** and enrol a second factor
   (Profile → Security). The seeded account can do everything.
2. **Create your company** and its locations, then your department tree.
   Everything else hangs off these.
3. **Turn on backups** (Settings → Backups): a daily database backup with a
   retention you are comfortable with, and a files backup if you are storing
   attachments locally.

Then invite people. An invitation grants an identity, not access — a new user
sees nothing until you add them to a group.

---

## 6. Verify before you trust it

Do not skip this. A backup you have never restored is a hope, not a backup.

```bash
# The stack is healthy
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml exec api node dist/cli/index.js doctor

# TLS is real and the certificate is valid
curl -sI https://reportly.example.com | head -1
```

Then, in the app: take a manual backup from Settings → Backups, download it, and
confirm the file is non-empty and roughly the size you would expect. Practise a
restore on a throwaway copy of the server before you need one for real.

---

## 7. Keep it running

### Start on boot

Compose services are declared `restart: always`, so Docker brings them back after
a reboot on its own. Confirm Docker itself starts:

```bash
sudo systemctl is-enabled docker    # should print "enabled"
```

### Upgrades

```bash
cd reportly
scripts/upgrade.sh
```

It backs the database up first, pulls, rebuilds, migrates, restarts, waits for
readiness and runs `doctor` — stopping at the first failure with the exact
command to roll back.

> **Upgrading an install first created before v0.3.0:** the job scheduler changed
> when BullMQ moved to v6. Old repeatable entries linger in Redis and can cause
> one extra run of the daily sweeps before they lapse. To clear them:
>
> ```bash
> docker compose -f compose.prod.yaml exec redis \
>   sh -c 'redis-cli --scan --pattern "bull:*:repeat*" | xargs -r redis-cli del'
> ```

### Watching it

```bash
docker compose -f compose.prod.yaml logs -f api
```

Logs are JSON, one object per line, with a stable field set — point Loki, Vector
or ELK at them and they parse without configuration. See
[the log contract](../operations.md#shipping-logs-elsewhere).

Worth alerting on: `GET /api/v1/ready` returning anything but 200, disk usage
over 80%, and a failed backup (the Backups screen shows the status of every run).

### Disk

Three things grow: the app database, the log database, and attachments.

```bash
docker system df                                    # images and volumes
docker compose -f compose.prod.yaml exec postgres \
  psql -U reportly -c "\l+"                         # database sizes
```

Log retention is a setting (Settings → Logging → Retention) and defaults to
keeping things longer than most installs need. Turning it down is the easiest
disk win. See [log database sizing](../operations.md#log-database-sizing).

---

## Troubleshooting

**`Cannot connect to the Docker daemon`** — the `newgrp docker` from step 1 has
not taken effect in this shell. Log out and back in.

**The API will not start, `BETTER_AUTH_SECRET` is mentioned** — working as
intended. Production refuses to boot on the development signing key rather than
silently accepting forgeable session cookies. Set a real one.

**The API will not start, and it names `WEB_URL` or `BETTER_AUTH_URL`** — also
intended. On a real hostname those must be `https`, because the session cookie
would otherwise travel without its `Secure` flag. Fix the scheme, or set
`ALLOW_INSECURE_HTTP=true` if you are genuinely on a trusted private network.

**No certificate; Caddy logs an ACME failure** — DNS does not point here yet, or
port 80 is closed. Check `dig +short <name>` and `sudo ufw status`.

**Everyone shows the same IP in the audit trail** — `TRUST_PROXY` does not match
the number of proxy hops. With the `tls` profile it is 2 (Caddy, then the web
container's nginx); without it, 1.

**Invitations never arrive** — run `doctor`. If SMTP is the failure, the emails
are queued rather than lost; they send once the relay is reachable.

**Something else** — start with `doctor`, then
[Operations → Troubleshooting](../operations.md#troubleshooting).
