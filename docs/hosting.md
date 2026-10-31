# Running nitpilot.dev

The runbook for the hosted instance at **https://nitpilot.dev**. For running Nitpilot on your own server, see [self-hosting.md](self-hosting.md) instead.

## The layout

nitpilot.dev runs on the same Hetzner box as Odyhook (a CX23: 2 vCPU, 4 GB, Helsinki; `ssh root@157.180.91.106`, hostname `hooksmith`). It borrows two of Odyhook's containers and adds one of its own:

| What | Where | Whose |
|---|---|---|
| `nitpilot-server`, the one Nitpilot container (the published image) | `/opt/nitpilot` (`docker-compose.yml` from `deploy/hosted/`, and `.env`) | Nitpilot |
| Postgres: the `nitpilot` database and role | inside `hooksmith-postgres-1` | Odyhook's container, Nitpilot's database |
| Caddy: HTTPS for `nitpilot.dev`, `www` → apex | `hooksmith-caddy-1`, two site blocks in Odyhook's `Caddyfile` | Odyhook's container and repo |
| The nightly backup | `/usr/local/bin/nitpilot-backup.sh`, `/etc/cron.d/nitpilot`, log `/var/log/nitpilot-cron.log` | Nitpilot |
| Backup files | R2 bucket `odyhook-backups`, under `nitpilot/` (rclone remote `r2`) | Odyhook's bucket, Nitpilot's folder |

All three containers are on Odyhook's Docker network `hooksmith_default`, where each is reached by its name: Caddy sends `nitpilot.dev` to `nitpilot-server:8787`, and the server reaches the database at `postgres:5432`. `nitpilot-server` publishes no port, so only containers on that network can reach it, and of those only Caddy talks to it.

Odyhook's own files (`/opt/hooksmith`, its backup script, its cron file) are never edited by hand. The `nitpilot.dev` blocks in its Caddyfile are changed only by a commit to Odyhook's repo, deployed by Odyhook's workflow (see "Caddy" below).

**Settings** are in `/opt/nitpilot/.env` (mode 600; made from `deploy/hosted/.env.example`): `NITPILOT_VERSION`, `PUBLIC_URL=https://nitpilot.dev`, `PUBLIC_REPOS_ONLY=true`, `TRUST_PROXY=true`, `CLOSED_CHAT_RETENTION_DAYS=90`, `ALLOWED_LOGINS` empty, `DEMO_REPO=NikosGkikas13/nitpilot-playground` once the playground's bots exist (Plan 4 G4), and the secrets (`DATABASE_URL`, `ENCRYPTION_KEY`, the VAPID keys, `DEMO_AUTHOR_TOKEN`: the author bot's GitHub token, which turns **Run a demo** on). The GitHub App `nitpilot` is not in `.env`: it was made through https://nitpilot.dev/first-run and is stored in the database, encrypted with `ENCRYPTION_KEY`.

**The one copy of `.env` off the box** is in the owner's password manager. Without it a backup can't bring the instance back ([why/backups-and-restores.md](why/backups-and-restores.md)). After any change to `.env`, run `ssh root@157.180.91.106 cat /opt/nitpilot/.env` in a terminal window of your own (Terminal or iTerm, not an AI assistant's in-chat `!` prompt, which sends the output into the chat) and update that copy; never paste it into a chat, an issue or a commit. If a secret does reach a chat, change it: for the database password, make a new one on the box, `ALTER ROLE nitpilot PASSWORD '…'` through `psql` on standard input (as in "Set it up" step 3), write it into `DATABASE_URL` with `set_env`, then `docker compose up -d --force-recreate --wait`. For `ENCRYPTION_KEY`, see "Rotating ENCRYPTION_KEY" below.

## Everyday commands

All on the box, in `/opt/nitpilot`:

```bash
ssh root@157.180.91.106
cd /opt/nitpilot
```

| To | Run |
|---|---|
| See if it's up | `docker compose ps` (look for `(healthy)`) |
| Ask it directly | `docker exec nitpilot-server node -e "fetch('http://127.0.0.1:8787/healthz').then(async (r) => console.log(r.status, await r.text()))"` (the image has no `curl` or `wget`) |
| Read the log | `docker compose logs --tail 100 nitpilot-server`, or `-f` to follow |
| Restart it | `docker compose restart` (CLIs see "server restarting" and reconnect; jobs carry on) |
| See its memory | `docker stats --no-stream` |
| Which version runs | `grep ^NITPILOT_VERSION= .env` and `docker inspect -f '{{.Config.Image}}' nitpilot-server` |

From anywhere: `curl -s https://nitpilot.dev/healthz` prints `{"ok":true,"version":"…"}`.

## Deploying a new version

Releases come from the release workflow (a `v*` tag, [releasing.md](releasing.md)); nothing is built on the box.

```bash
cd /opt/nitpilot
sed -i 's/^NITPILOT_VERSION=.*/NITPILOT_VERSION=0.1.1/' .env
docker compose pull
docker compose up -d
docker compose ps
```

`up -d` replaces the container: the old server gets SIGTERM, finishes the step it's on and tells each CLI "server restarting"; the new one runs any new migrations, then starts. Expect `(healthy)` within a minute and the new version in `curl -s https://nitpilot.dev/healthz`.

**Going back** is the same with the old version number. The newer version's migrations stay in the database, so check its release notes first: going back is safe when they only added tables or columns.

## Rotating ENCRYPTION_KEY

Do this when the key may have leaked (it reached a chat, a log, someone who shouldn't have it). It needs 0.3.1 or newer. How it works: [why/key-rotation.md](why/key-rotation.md). The key is made on the box and never printed.

1. Move the current key to `ENCRYPTION_KEY_PREVIOUS`, make a new one, and restart:

   ```bash
   ssh root@157.180.91.106 bash -s <<'EOF'
   set -euo pipefail
   cd /opt/nitpilot && umask 077
   set_env() { K="$1" V="$2" awk 'BEGIN { FS = OFS = "=" } $1 == ENVIRON["K"] { $0 = ENVIRON["K"] "=" ENVIRON["V"] } { print }' .env > .env.tmp && mv .env.tmp .env; }
   grep -q '^ENCRYPTION_KEY_PREVIOUS=' .env || echo 'ENCRYPTION_KEY_PREVIOUS=' >> .env
   test -z "$(grep '^ENCRYPTION_KEY_PREVIOUS=' .env | cut -d= -f2-)" || { echo "STOP: a rotation is already under way"; exit 1; }
   set_env ENCRYPTION_KEY_PREVIOUS "$(grep '^ENCRYPTION_KEY=' .env | cut -d= -f2-)"
   set_env ENCRYPTION_KEY "$(openssl rand -base64 32)"
   ls -l .env && awk -F= '/^ENCRYPTION_KEY/ { print $1, ($2 == "" ? "(empty)" : "(set)") }' .env
   docker compose up -d --force-recreate --wait
   docker compose logs nitpilot-server | grep -E '\[keys\]|\[boot\] GitHub App' | tail -n 2
   EOF
   ```

   The log shows `[keys] re-encrypted N stored values …` (N is 2 per person who signed in, plus 3 for the GitHub App) and `[boot] GitHub App nitpilot, from the database`. If the server won't start, nothing was changed in the database: put the old key back as `ENCRYPTION_KEY` with `set_env`, empty `ENCRYPTION_KEY_PREVIOUS`, and restart.

2. Check https://nitpilot.dev/healthz, and sign in at https://nitpilot.dev (your stored GitHub token must still work: the inbox loads).

3. Save the old key for old backups, then drop it from `.env`. Every backup made before today was dumped with the old key, so restoring one needs it (see "Put a backup back"). Run `ssh root@157.180.91.106 cat /opt/nitpilot/.env` in a terminal window of your own and copy the `ENCRYPTION_KEY_PREVIOUS` line into the password manager next to `.env`, labelled with today's date. Then:

   ```bash
   ssh root@157.180.91.106 bash -s <<'EOF'
   set -euo pipefail
   cd /opt/nitpilot && umask 077
   set_env() { K="$1" V="$2" awk 'BEGIN { FS = OFS = "=" } $1 == ENVIRON["K"] { $0 = ENVIRON["K"] "=" ENVIRON["V"] } { print }' .env > .env.tmp && mv .env.tmp .env; }
   set_env ENCRYPTION_KEY_PREVIOUS ""
   docker compose up -d --force-recreate --wait && docker compose ps
   EOF
   ```

4. Save the new `.env` to the password manager (the `cat` above, in your own terminal).

## Memory

The box has 4 GB. Odyhook's containers have caps that add up to about 4.2 GB (caps limit, they don't reserve), and `nitpilot-server` is capped at 384 MB (`mem_limit` in `docker-compose.yml`). `docker stats --no-stream` shows what each really uses. If `nitpilot-server` sits near its cap, raise it in `docker-compose.yml` (in this repo, then copy it over) only if `free -m` shows the room; if the box itself is short, stop and ask rather than add anything.

**Odyhook's deploys build on the box.** Odyhook's deploy runs `docker compose up -d --build`, which runs `next build` on this box, next to everything that's already running. The box has no swap. On 2026-10-25, the first Odyhook deploy with `nitpilot-server` running (about 170 MB) used up the memory: SSH stopped answering, odyhook.dev and nitpilot.dev went down, GitHub cancelled the deploy after its 15-minute limit, and the box came back only after a **Power cycle** in the Hetzner console (the server → **Power** → **Power cycle**). Every container came back on its own; nothing was lost. Until Odyhook builds somewhere else or the box gets more room (the owner's decision), treat every merge to Odyhook's `main` as a risk: `docker compose stop` in `/opt/nitpilot` before it, `docker compose up -d --wait` after its deploy is green. That frees about 170 MB; it has not been shown to be enough.

## Backups

Every night at 03:30 UTC, after Odyhook's 03:00 backup, cron runs `nitpilot-backup.sh`: `pg_dump` of the `nitpilot` database inside Odyhook's Postgres, checked for completeness, gzipped, uploaded to `r2:odyhook-backups/nitpilot/nitpilot-<UTC time>.sql.gz`. Each run writes one line to `/var/log/nitpilot-cron.log`, `ok …` or `FAILED: …`.

| To | Run |
|---|---|
| Back up now | `/usr/local/bin/nitpilot-backup.sh` |
| See the last runs | `tail -n 5 /var/log/nitpilot-cron.log` |
| List the backups | `rclone ls r2:odyhook-backups/nitpilot \| sort -k2 \| tail` |

How long R2 keeps them is the bucket's lifecycle rule, set up for Odyhook (14 days); see that rule in Cloudflare's dashboard (R2 → `odyhook-backups` → Settings → Object lifecycle rules) for whether it covers `nitpilot/`.

Odyhook's own listings (`rclone ls r2:odyhook-backups …` in its `infra/` docs) look inside folders, so they now show these `nitpilot/…` files too. Odyhook's are the `odyhook-…` files at the top level; nothing changes on its side.

Installing them (done once, in Plan 3 Task 12): copy `deploy/hosted/nitpilot-backup.sh` to `/usr/local/bin/` (mode 755) and `deploy/hosted/cron` to `/etc/cron.d/nitpilot` (mode 644). cron reads `/etc/cron.d/` every minute.

## Restoring

### Check a backup (do this now and then)

Loads the newest backup into a scratch database next to the real one, counts rows in both, and drops the scratch one. The live database isn't touched. It first drops any scratch copy an earlier check left behind (one cut short half way), so that copy can never be counted by mistake.

```bash
f="$(rclone lsf r2:odyhook-backups/nitpilot | sort | tail -n 1)" && echo "$f"
docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -q -v ON_ERROR_STOP=1 -c 'set client_min_messages = warning' -c 'drop database if exists nitpilot_restore_check' -c 'create database nitpilot_restore_check owner nitpilot'
rclone cat "r2:odyhook-backups/nitpilot/$f" | gunzip | docker exec -i hooksmith-postgres-1 psql -q -o /dev/null -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot_restore_check
for db in nitpilot nitpilot_restore_check; do docker exec hooksmith-postgres-1 psql -U nitpilot -d "$db" -Atc 'select current_database(), (select count(*) from "_prisma_migrations"), (select count(*) from "User"), (select count(*) from "PrChat"), (select count(*) from "GithubAppConfig")'; done
docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -qc 'drop database nitpilot_restore_check'
```

The two count lines should match, except for whatever happened since the backup (new chats, new people). `GithubAppConfig` is `1` in both.

### Put a backup back (the database was lost or broken)

This replaces the live `nitpilot` database. Nitpilot is down meanwhile; Odyhook isn't touched. Not between 03:00 and 04:00 UTC, so the nightly backup can't dump a half-restored database.

First download the backup and check it's whole. Go on only if it prints `file ok`: the live database isn't touched until the next block.

```bash
cd /opt/nitpilot
f=nitpilot-2026-10-25T03-30-01Z.sql.gz     # the backup to restore, from rclone ls
rclone copyto "r2:odyhook-backups/nitpilot/$f" "/root/$f" && gunzip -c "/root/$f" | tail -n 20 | grep -q -- '-- PostgreSQL database dump complete' && echo "file ok"
```

A backup from before the last key rotation was made with the old key: put that key in `ENCRYPTION_KEY_PREVIOUS` (with `set_env`, as in "Rotating ENCRYPTION_KEY") before the `up` below, and the server moves it onto the current key as it starts; then empty it again.

Then replace the database with it:

```bash
docker compose stop
docker exec hooksmith-postgres-1 psql -U hooksmith -d postgres -c 'drop database nitpilot' -c 'create database nitpilot owner nitpilot'
gunzip -c "/root/$f" | docker exec -i hooksmith-postgres-1 psql -q -o /dev/null -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot && rm "/root/$f"
docker compose up -d --wait
docker compose logs --tail 20 nitpilot-server
```

`--wait` returns once the server answers its health check, so the log shows this start. The log should say `[boot] GitHub App nitpilot, from the database` and the server listening, not first-run mode. If it says first-run mode, the dump was empty or from before the app was made: stop (`docker compose stop`) and pick another file; never create a second app over it.

### On a new box

1. Set up Odyhook first (its `infra/recovery.md`), so `hooksmith-postgres-1`, its Caddy (with the `nitpilot.dev` blocks, from its repo) and the `hooksmith_default` network exist, and the rclone remote `r2` works.
2. `mkdir -p /opt/nitpilot`; copy `deploy/hosted/docker-compose.yml` there; paste `.env` from the password manager into `/opt/nitpilot/.env` (`umask 077` first, so it's mode 600).
3. Make the role and database with the password inside that `.env`'s `DATABASE_URL`: the commands in "Set it up" step 3 below.
4. Restore the newest backup with the "Put a backup back" commands, leaving out the `psql … drop database … create database` line: step 3 already made the empty database.
5. Point the DNS records at the new box's address (Porkbun), install the backup script and cron file again.

## Set it up (once)

What Plan 3 Task 12 did, here so a new box can be set up the same way. Every command runs on the box; none prints a secret.

1. `mkdir -p /opt/nitpilot` and copy `deploy/hosted/docker-compose.yml` and `deploy/hosted/.env.example` there (`scp` from a checkout).
2. Make `.env`, with fresh secrets written straight into the file. `VERSION` is the image to run. Paste the whole block: it runs in its own `bash`, which stops at the first error (and an `exit` there doesn't close your ssh session):
   ```bash
   bash -s <<'EOF'
   set -euo pipefail
   cd /opt/nitpilot && VERSION=0.1.0 && umask 077
   test ! -e .env || { echo "STOP: .env already exists"; exit 1; }
   cp .env.example .env
   set_env() { K="$1" V="$2" awk 'BEGIN { FS = OFS = "=" } $1 == ENVIRON["K"] { $0 = ENVIRON["K"] "=" ENVIRON["V"] } { print }' .env > .env.tmp && mv .env.tmp .env; }
   set_env NITPILOT_VERSION "$VERSION"
   set_env DATABASE_URL "postgresql://nitpilot:$(openssl rand -hex 24)@postgres:5432/nitpilot"
   set_env ENCRYPTION_KEY "$(openssl rand -base64 32)"
   read -r pub priv < <(docker run --rm --entrypoint node "ghcr.io/nikosgkikas13/nitpilot:$VERSION" -e "const k = require('web-push').generateVAPIDKeys(); console.log(k.publicKey, k.privateKey)")
   set_env VAPID_PUBLIC_KEY "$pub" && set_env VAPID_PRIVATE_KEY "$priv" && unset pub priv
   ls -l .env && awk -F= '!/^#/ && NF { print $1, ($2 == "" ? "(empty)" : "(set)") }' .env
   EOF
   ```
   Every name says `(set)` except `ALLOWED_LOGINS`, and `ls` shows `-rw-------`.
3. The role and database, inside Odyhook's Postgres, with the password from `.env` (passed on standard input, so it never shows up in a process list). Again one block in its own `bash`:
   ```bash
   bash -s <<'EOF'
   set -euo pipefail
   cd /opt/nitpilot
   pw="$(sed -n 's|^DATABASE_URL=postgresql://nitpilot:\([0-9a-f]*\)@postgres:5432/nitpilot$|\1|p' .env)"
   test ${#pw} -eq 48 || { echo "STOP: no password in .env's DATABASE_URL"; exit 1; }
   docker exec -i hooksmith-postgres-1 psql -U hooksmith -d postgres -v ON_ERROR_STOP=1 -q <<SQL
   CREATE ROLE nitpilot LOGIN PASSWORD '$pw';
   CREATE DATABASE nitpilot OWNER nitpilot;
   REVOKE ALL ON DATABASE nitpilot FROM PUBLIC;
   SQL
   unset pw
   EOF
   ```
4. `docker compose up -d`, then `docker compose logs nitpilot-server | grep 'setup code' | tail -n 1` for the setup code (it changes each time the server starts), and make the GitHub App at https://nitpilot.dev/first-run. Before clicking **Create GitHub App for …** on GitHub's page, check that the name at the top is `nitpilot` (the first-run page's default is `Nitpilot (nitpilot.dev)`, which GitHub turns into `nitpilot-nitpilot-dev`) and that **Any account** is chosen. If the app came out wrong and nobody has installed it yet: delete it on GitHub (the app's settings → **Advanced** → **Delete GitHub App**), then `docker exec hooksmith-postgres-1 psql -U nitpilot -d nitpilot -c 'delete from "GithubAppConfig"' -c 'delete from "RawEvent"'` and `docker compose restart nitpilot-server`; the server is back in first-run mode with a new setup code.
5. The backup script and cron file ("Backups" above), and save `.env` in the password manager.

## Caddy

Odyhook's Caddy answers for both sites. Its `Caddyfile` (in NikosGkikas13/odyhook) has these two blocks for Nitpilot, with a comment saying so:

```
nitpilot.dev {
    reverse_proxy nitpilot-server:8787
}

www.nitpilot.dev {
    redir https://nitpilot.dev{uri} permanent
}
```

Caddy gets and renews the `nitpilot.dev` certificate itself, redirects `http://` to `https://`, and passes WebSockets (`/ws/cli`, `/ws/web`) through. To change them: a commit to Odyhook's repo, merged to its `main`, which redeploys Odyhook (read "Odyhook's deploys build on the box" under Memory first). That deploy does `git pull` and `docker compose up -d --build`, which doesn't restart Caddy, and a running Caddy never rereads its file. So after the deploy, restart Caddy once (odyhook.dev and nitpilot.dev both blink for a second or two):

```bash
cd /opt/hooksmith && docker compose -f docker-compose.prod.yml restart caddy
docker exec hooksmith-caddy-1 grep -c 'nitpilot.dev' /etc/caddy/Caddyfile
```

The `grep` should count `3` (the three lines that name the domain). `0` means Caddy still has the old file: restart it again.

**DNS** (Porkbun, the `nitpilot.dev` domain): `A` for the bare domain and `A` for `www`, both `157.180.91.106`.

## After Odyhook's own deploys

Odyhook redeploys on every push to its `main`. Nitpilot needs nothing from you then, but if something looks off afterwards:

- **Odyhook's Postgres was restarted** (a new Postgres image, a box reboot): `nitpilot-server` loses its database connection, exits on purpose, and Docker starts it again; it's back within a minute. `docker compose ps` in `/opt/nitpilot` shows it `(healthy)`, and `docker inspect -f '{{.RestartCount}}' nitpilot-server` went up by one.
- **Odyhook ran `docker compose down`**: Compose says `Network hooksmith_default Resource is still in use` and leaves the network (Nitpilot is still on it); Odyhook's next `up -d` uses it again. Nothing to do.
- **nitpilot.dev answers 502**: Caddy is up but `nitpilot-server` isn't. `docker compose ps` and `docker compose logs --tail 50 nitpilot-server` in `/opt/nitpilot`.
- **nitpilot.dev doesn't answer at all, odyhook.dev neither**: Caddy is down; that's Odyhook's side (`docker compose -f docker-compose.prod.yml ps` in `/opt/hooksmith`).
