# Backups and restores (and why a backup you never restored isn't one)

**In one sentence:** a backup is a copy of the database taken every night and kept somewhere else, and it only counts once you've loaded one back and seen your data in it.

## The React comparison

Think of `git push` for your work in progress. Your laptop holds the real thing; the remote holds a copy, somewhere that doesn't die with the laptop. If the laptop is stolen you `git clone` and carry on.

A database backup is the same idea for the server's data. The server's disk holds the live database; every night a copy goes to another company's storage (Cloudflare R2), so a dead disk, a deleted server or a bad migration costs at most one day.

The difference from git: nobody runs `git clone` on a backup until the day they need it. A backup that was silently empty for three months looks exactly like a good one until then. That's why Nitpilot's setup includes **restoring one on purpose** into a scratch database and counting the rows.

## What gets copied

- **`pg_dump`** writes the whole database out as SQL: `CREATE TABLE …` for every table, then every row. Loading that file into an empty database (`psql < dump.sql`) rebuilds it exactly. It reads a consistent snapshot, so the server can keep running while it works.
- **gzip** shrinks it (SQL text compresses well).
- **rclone** uploads it. It's `cp` for cloud storage: the box already has an rclone "remote" called `r2` set up for Odyhook's backups, and Nitpilot's files go into the same bucket under `nitpilot/`.

The script checks that `pg_dump` finished (its output ends with a "dump complete" line) before it uploads, so a dump cut short by a crash is never stored as if it were good.

## What a backup can't bring back on its own

The database holds the GitHub App's private key and secrets and people's GitHub tokens, **encrypted with `ENCRYPTION_KEY`** ([first-run-and-app-manifests.md](first-run-and-app-manifests.md)). That key lives in the server's `.env`, not in the database, on purpose: someone who gets a copy of the backup gets only scrambled secrets.

So a restore needs two things: the dump **and** the `.env` it was made with. The dump is in R2; the `.env` has one copy outside the server, in the owner's password manager. Lose the key and the restored database still has every chat, but the server can't use its GitHub App and refuses to start; you'd have to make a new app.

## Where

- `deploy/hosted/nitpilot-backup.sh`: the nightly backup for nitpilot.dev (dump, check, gzip, upload, one log line).
- `deploy/hosted/cron`: runs it at 03:30 UTC, after Odyhook's own backup.
- `docs/hosting.md`, "Backups" and "Restoring": the commands, including the restore into a scratch database.
- `docs/self-hosting.md`, "Backups" and "Restoring": the same idea for a team's own server.
