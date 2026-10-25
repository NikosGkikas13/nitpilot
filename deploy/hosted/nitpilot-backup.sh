#!/usr/bin/env bash
# Nitpilot's nightly backup on the Hetzner box (spec §17 "Hosted instance", docs/hosting.md "Backups",
# docs/why/backups-and-restores.md). Installed as /usr/local/bin/nitpilot-backup.sh and run by /etc/cron.d/nitpilot at
# 03:30 UTC, after Odyhook's own backup at 03:00. Odyhook's script and cron file are left alone.
#
# What it does: dump the `nitpilot` database from inside Odyhook's Postgres container, check the dump is whole, gzip
# it, and upload it to the same R2 bucket as Odyhook's backups under nitpilot/, through the rclone remote already set
# up on the box. One line goes to the log either way.
#
# The defaults are the box's real names (infra/README.md in Odyhook's repo); each can be changed for a check elsewhere:
#   NITPILOT_PG_CONTAINER=other-postgres NITPILOT_BACKUP_DEST=r2:some-bucket/nitpilot nitpilot-backup.sh
set -euo pipefail

pg_container="${NITPILOT_PG_CONTAINER:-hooksmith-postgres-1}"
dest="${NITPILOT_BACKUP_DEST:-r2:odyhook-backups/nitpilot}"

# The same naming as Odyhook's backups: UTC time, with dashes so the name sorts and works in any shell.
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
name="nitpilot-$stamp.sql.gz"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) nitpilot-backup: $*"; }

# A temporary folder only root can read, deleted however the script ends.
work="$(mktemp -d "${TMPDIR:-/tmp}/nitpilot-backup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
dump="$work/nitpilot.sql"

# Inside the Postgres container a local connection needs no password. --no-owner / --no-privileges keep the dump
# loadable as any role, so a restore into a scratch database (or a new server) doesn't depend on role names.
if ! docker exec "$pg_container" pg_dump -U nitpilot -d nitpilot --no-owner --no-privileges > "$dump"; then
  log "FAILED: pg_dump from $pg_container"
  exit 1
fi

# pg_dump writes this line last. If it's missing, the dump stopped half way and must not be uploaded as if it were good.
if ! tail -n 5 "$dump" | grep -q -- '-- PostgreSQL database dump complete'; then
  log "FAILED: the dump is incomplete"
  exit 1
fi

gzip -9 "$dump"
if ! rclone copyto "$dump.gz" "$dest/$name"; then
  log "FAILED: upload to $dest/$name"
  exit 1
fi

log "ok $dest/$name ($(wc -c < "$dump.gz" | tr -d ' ') bytes)"
