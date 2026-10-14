# Source this in every terminal tab of the acceptance run, from the Nitpilot checkout:
#   cd /path/to/nitpilot && source docs/acceptance/env.sh
# It defines nit-a and nit-b (the CLI as account A and as account B), nit-edit (change a CLI's config) and dbq (psql on the acceptance database).
export REPO="$PWD"
export SANDBOX=NikosGkikas13/nitpilot-sandbox
export SERVER=http://localhost:8787
export ACC_DB=nitpilot_acceptance
export CLONE_A="$HOME/nitpilot-acceptance/a/nitpilot-sandbox"
export CLONE_B="$HOME/nitpilot-acceptance/b/nitpilot-sandbox"

# A runs the built CLI with Claude Code, like a user who installed it. Build it first: npm run build -w apps/cli
nit-a() {
  NITPILOT_CONFIG_DIR="$HOME/.nitpilot-a" NITPILOT_SERVER="$SERVER" node "$REPO/apps/cli/dist/index.js" "$@"
}

# B runs from source (the fake agent only exists in a source checkout) and follows $B_SCENARIO.
nit-b() {
  NITPILOT_CONFIG_DIR="$HOME/.nitpilot-b" NITPILOT_SERVER="$SERVER" \
    NITPILOT_FAKE_SCENARIO="${B_SCENARIO:-$REPO/docs/acceptance/scenarios/sandbox-happy.json}" \
    "$REPO/node_modules/.bin/tsx" "$REPO/apps/cli/src/index.ts" "$@"
}

# nit-edit a '.agent = "fake"'   changes ~/.nitpilot-a/config.json with a jq filter and keeps the file readable by you only.
nit-edit() {
  local dir="$HOME/.nitpilot-$1" file="$HOME/.nitpilot-$1/config.json"
  jq "$2" "$file" > "$file.tmp" && chmod 600 "$file.tmp" && mv "$file.tmp" "$file"
}

# dbq -c 'select 1'   or   dbq -v pr=5 -f - < docs/acceptance/check.sql   (runs psql inside the Postgres container)
dbq() {
  docker exec -i nitpilot-postgres-1 psql -U nitpilot -d "$ACC_DB" "$@"
}
