#!/usr/bin/env bash
# A new PR branch for the acceptance run: the seed (docs/acceptance/seed/orders-demo) on top of main, pushed as
# account A. Run it inside clone A, with $REPO set (source docs/acceptance/env.sh first):
#   bash "$REPO/docs/acceptance/new-branch.sh" happy
set -euo pipefail

name="${1:?Usage: new-branch.sh <name>   (the branch will be acc/<name>)}"
: "${REPO:?Run: source docs/acceptance/env.sh from the Nitpilot checkout first}"
branch="acc/$name"

git fetch origin main
git switch -c "$branch" origin/main
cp -R "$REPO/docs/acceptance/seed/orders-demo" .
git add orders-demo
git commit -m "Add orders-demo ($name)"
git push -u origin "$branch"

slug="$(git remote get-url origin | sed -E 's#^.*[:/]([^/]+/[^/]+)$#\1#; s#\.git$##')"
echo
echo "Branch pushed. Open the pull request as account A:"
echo "  https://github.com/$slug/compare/main...$branch?expand=1"
