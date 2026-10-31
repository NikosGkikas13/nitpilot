#!/usr/bin/env bash
# Fills an empty GitHub repo with the playground: the base project on main, and one branch per folder in
# branches/ (branches/discount → demo/discount), each adding a file with a bug the fake reviewer catches.
# Usage: docs/playground/seed.sh <path to an empty local clone of the playground repo>
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
clone="${1:?Give the path to an empty clone of the playground repo}"
cd "$clone"

if [ -n "$(git rev-parse --verify --quiet HEAD || true)" ]; then
  echo "This clone already has commits. Seed an empty repo." >&2
  exit 1
fi

git checkout -B main
cp -R "$here/repo/." .
git add -A
git commit -m "The playground's base project"
git push -u origin main

for dir in "$here"/branches/*/; do
  name="demo/$(basename "$dir")"
  git checkout -b "$name" main
  cp -R "$dir." .
  git add -A
  git commit -m "Add $(basename "$dir")"
  git push -u origin "$name"
  git checkout main
done

echo "Seeded main and $(ls "$here/branches" | wc -l | tr -d ' ') demo branches."
