# Self-hosting Nitpilot

Run your own Nitpilot server: for private repos, or to keep everything on your own machine. It's one folder with three files (`deploy/self-host/` in this repo): the published image, Postgres and Caddy, started with Docker Compose. The server creates its own GitHub App the first time you open it. Why it's built this way: spec §17 "Self-hosting", [why/first-run-and-app-manifests.md](why/first-run-and-app-manifests.md), [why/reverse-proxy-and-tls.md](why/reverse-proxy-and-tls.md).

## What you need

- **A server with Docker** (Docker Engine with the Compose plugin: `docker compose version` prints a version). 1 GB of memory is plenty; Nitpilot is one Node process and Postgres.
- **A domain or subdomain** for it, e.g. `nitpilot.example.com`, whose DNS you can edit.
- **Ports 80 and 443 open** to the internet on that server (Caddy needs both to get its HTTPS certificate). Nothing else needs to be open.
- **A GitHub account or organization** to own the GitHub App (for an organization you must be one of its owners).

Private repos work: `PUBLIC_REPOS_ONLY` is off unless you set it, so the app can be installed on any repo you choose.

## Set it up

### 1. Point the domain at the server

At your DNS provider, add an **A record**: name `nitpilot` (or whatever subdomain you picked), value your server's public IPv4 address. Add an **AAAA** record too if the server has IPv6. Check it from your own computer before going on; it must print the server's address:

```bash
dig +short nitpilot.example.com
```

Caddy asks Let's Encrypt for a certificate as soon as it starts, and Let's Encrypt checks the domain by connecting to it, so the record has to be right first ([why/dns-records.md](why/dns-records.md)).

### 2. Get the folder and fill in `.env`

On the server:

```bash
mkdir nitpilot && cd nitpilot
for f in docker-compose.yml Caddyfile .env.example; do curl -fsSLO "https://raw.githubusercontent.com/NikosGkikas13/nitpilot/main/deploy/self-host/$f"; done
cp .env.example .env
```

Every `docker compose` command below runs in this folder.

Open `.env` and fill in the three required values:

- `NITPILOT_DOMAIN=nitpilot.example.com` (no `https://`)
- `POSTGRES_PASSWORD=` the output of `openssl rand -hex 24`
- `ENCRYPTION_KEY=` the output of `openssl rand -base64 32`

`ENCRYPTION_KEY` encrypts people's GitHub tokens and the GitHub App's private key and secrets in the database. **Save a copy of `.env` somewhere safe now** (a password manager): a backup of the database can't be used without this key, and a server whose key changed refuses to start.

The rest of `.env.example` is optional, one comment line each: web push keys, `ALLOWED_LOGINS`, `CLOSED_CHAT_RETENTION_DAYS`, `NITPILOT_VERSION`. Web push keys are made with the image itself:

```bash
docker compose run --rm --no-deps nitpilot node -e "const k = require('web-push').generateVAPIDKeys(); console.log('VAPID_PUBLIC_KEY=' + k.publicKey + '\nVAPID_PRIVATE_KEY=' + k.privateKey)"
```

Paste both lines into `.env`, and set `VAPID_SUBJECT=https://nitpilot.example.com`. Run it once: a new key pair means everyone has to turn push on again.

### 3. Start it

```bash
docker compose up -d
docker compose ps
```

After a few seconds `docker compose ps` shows `postgres` and `nitpilot` as `(healthy)` and `caddy` as `Up`. On its first start the server creates its tables (`docker compose logs nitpilot` shows `Applying migration …` and `All migrations have been successfully applied.`), and Caddy gets its certificate (`docker compose logs caddy` shows `certificate obtained successfully`).

### 4. Create the GitHub App on the first-run page

The server has no GitHub App yet, so it starts in **first-run mode** and prints a one-time setup code. Find it:

```bash
docker compose logs nitpilot | grep "setup code" | tail -1
```

It prints `[first-run] Open https://nitpilot.example.com/first-run and enter the setup code: XXXX-XXXX`. Only someone who can read the server's log has the code, so nobody else can claim the server before you.

Open `https://nitpilot.example.com/first-run`, enter the code, choose your personal account or an organization, a name for the app, and who may install it (keep "only this account" unless you want strangers to install your server's app), then **Create GitHub App**. GitHub shows its own "Create GitHub App" page, already filled in: click **Create GitHub App** there. GitHub sends you back; the page says "Restarting the server…" while the server stores the app (encrypted with `ENCRYPTION_KEY`) and Docker starts it again in normal mode.

### 5. Install the app, sign in, and connect your CLI

When the page offers **Install the app on your repos**, click it, choose the repos Nitpilot should work on (private ones too), and install. Then **Sign in** with GitHub.

Everyone who uses this server points their CLI at it (`npm install -g nitpilot` first):

```bash
NITPILOT_SERVER=https://nitpilot.example.com nitpilot login
```

`login` saves the address as `"server"` in the CLI's config file (`~/.config/nitpilot/config.json`), so later commands (`nitpilot repos add`, `nitpilot start`) use it without the variable. You can also write `"server": "https://nitpilot.example.com"` in that file yourself.

## Upgrading

```bash
docker compose pull
docker compose up -d
```

`pull` downloads the newest image for the tag in `NITPILOT_VERSION` (`latest` when it's empty), and `up -d` replaces only the containers whose image or settings changed. The server stops politely (connected CLIs reconnect on their own), runs any new database migrations, and starts.

To stay on one version, set `NITPILOT_VERSION=0.1.0` in `.env` and run `docker compose up -d`; to move, change it and run the same command (Compose downloads a version it doesn't have yet). Back up before upgrading: migrations only go forward, so returning to an older version after one ran is not guaranteed to work.

After editing `.env`, `docker compose up -d` recreates the containers that use it. `docker compose restart nitpilot` restarts the server with its current settings.

## Backups

The database holds everything: chats, settings, the GitHub App. Dump it to a file:

```bash
docker compose exec -T postgres pg_dump -U nitpilot -d nitpilot | gzip > nitpilot-$(date +%F).sql.gz
```

Copy the file off the server, and run it every day (from cron, for example). **Keep `.env` too**, in a separate safe place: the GitHub App's private key and secrets, and people's GitHub tokens, are stored encrypted with its `ENCRYPTION_KEY`, so a dump without the key can't bring the server back.

## Restoring

On a new server (or after losing the database), with the same `.env` (same `ENCRYPTION_KEY`) and the dump file in the folder:

```bash
docker compose up -d --wait postgres
gunzip -c nitpilot-2026-10-24.sql.gz | docker compose exec -T postgres psql -q -v ON_ERROR_STOP=1 -U nitpilot -d nitpilot
docker compose up -d
```

The server finds its GitHub App in the restored database and starts in normal mode (`docker compose logs nitpilot` shows `[boot] GitHub App <your app>, from the database`). If the domain moved to a new IP, update the DNS record first. Restoring over an existing database needs it empty first: `docker compose down -v` deletes it (and Caddy's certificates) for good, so only do that when the dump is safe.

## Behind another HTTPS proxy

If something in front of this server already does HTTPS (a load balancer, Cloudflare Tunnel, another Caddy or nginx), let Caddy serve plain HTTP on port 80 and trust that proxy's headers. In `.env`:

```
SITE_ADDRESS=:80
TRUSTED_PROXIES=private_ranges
```

`TRUSTED_PROXIES` lists the addresses the outer proxy connects from (`private_ranges` covers the private networks, including Docker's own; or give exact ranges like `10.0.0.0/8`). Without it, Caddy tells the server every request came in over plain http, and sign-in keeps redirecting to `https://` in a loop. `NITPILOT_DOMAIN` stays the public name people open.

Make sure only that proxy can reach port 80, since Caddy now believes what it says. When the proxy runs on the same machine, bind Caddy to the loopback address with a `docker-compose.override.yml` next to the other files (Compose reads it automatically):

```yaml
services:
  caddy:
    ports: !override
      - "127.0.0.1:80:80"
```

## Troubleshooting

Start with `docker compose ps` and `docker compose logs nitpilot` (or `logs caddy`).

- **Lost the setup code, or it says it doesn't match:** use the last one printed (`docker compose logs nitpilot | grep "setup code" | tail -1`). `docker compose restart nitpilot` prints a new one; the old one stops working. Five tries a minute per address; after that the page asks you to wait.
- **`nitpilot` keeps restarting with "The stored GitHub App can't be read with this ENCRYPTION_KEY. Put back the key it was made with."** `ENCRYPTION_KEY` in `.env` isn't the one the app was stored with. Put the old value back from your saved copy and run `docker compose up -d`. The server never starts a new first run over the stored app.
- **`nitpilot` keeps restarting with "set all six GitHub App variables, or none to start in first-run mode; missing: …"** Some `GITHUB_*` lines are in `.env` and some are empty. Remove them all (to use the app first-run mode made) or fill in all six (for an app you made by hand; they win over a stored app).
- **No certificate / the browser can't connect:** `docker compose logs caddy`. Usually the DNS record doesn't point at this server yet (`dig +short` it) or ports 80 and 443 are blocked by a firewall.
- **Sign-in loops back to the same page behind another proxy:** set `TRUSTED_PROXIES` (above).
