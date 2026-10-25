# Source this in every terminal tab of the Plan 3 run (docs/acceptance/plan-3.md), from the Nitpilot checkout:
#   cd /path/to/nitpilot && source docs/acceptance/hosted.sh
# Unlike env.sh there is no local server: every CLI talks to https://nitpilot.dev, the CLI's default (no NITPILOT_SERVER).
export REPO="$PWD"
export SANDBOX=NikosGkikas13/nitpilot-sandbox
export BOX=root@157.180.91.106
export CLONE_A="$HOME/nitpilot-acceptance/a/nitpilot-sandbox"   # ngkdev93-jpg's clone (github-a)
export CLONE_B="$HOME/nitpilot-acceptance/b/nitpilot-sandbox"   # NikosGkikas13's clone (github-b)

# NikosGkikas13, the reviewer: the built CLI with Claude Code, named like the installed one so the demo shows
# `nitpilot start`. Build it first: npm run build -w apps/cli
nitpilot() {
  NITPILOT_CONFIG_DIR="$HOME/.nitpilot-hosted-r" node "$REPO/apps/cli/dist/index.js" "$@"
}

# NikosGkikas13 again, from source with the fake agent (it only exists in a source checkout), same config folder.
# Follows $R_SCENARIO. Its config must say "agent": "fake" first: nit-edit r '.agent = "fake"'.
nit-rf() {
  NITPILOT_CONFIG_DIR="$HOME/.nitpilot-hosted-r" \
    NITPILOT_FAKE_SCENARIO="${R_SCENARIO:-$REPO/docs/acceptance/scenarios/sandbox-happy.json}" \
    "$REPO/node_modules/.bin/tsx" "$REPO/apps/cli/src/index.ts" "$@"
}

# ngkdev93-jpg, the author in the agent-to-agent run: the built CLI with Claude Code.
nit-w() {
  NITPILOT_CONFIG_DIR="$HOME/.nitpilot-hosted-w" node "$REPO/apps/cli/dist/index.js" "$@"
}

# nit-edit r '.agent = "fake"'   changes ~/.nitpilot-hosted-r/config.json with a jq filter, readable by you only.
nit-edit() {
  local file="$HOME/.nitpilot-hosted-$1/config.json"
  jq "$2" "$file" > "$file.tmp" && chmod 600 "$file.tmp" && mv "$file.tmp" "$file"
}

# boxq -c 'select 1'   or   boxq -v pr=5 -f - < docs/acceptance/check.sql
# psql on nitpilot.dev's database, over ssh, inside Odyhook's Postgres container. Read-only use only.
boxq() {
  ssh "$BOX" "docker exec -i hooksmith-postgres-1 psql -U nitpilot -d nitpilot $(printf '%q ' "$@")"
}

# boxlog 50   the last lines of the server's log.
boxlog() {
  ssh "$BOX" "cd /opt/nitpilot && docker compose logs --tail ${1:-50} nitpilot-server"
}
