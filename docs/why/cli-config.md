# Where the CLI keeps your settings (and your token)

**In one sentence:** `nitpilot` keeps one small JSON file per account, readable by you only, and environment variables can override two of its settings without touching it.

## The file (`apps/cli/src/config/config.ts`)

`~/.config/nitpilot/config.json` holds the server's address, this device's token from `nitpilot login`, which agent you use, your limits (`concurrency`, `jobTimeoutMinutes`) and your linked clones (`repos`). Every setting has a default (spec §13), so a missing file just means "all defaults". The file is checked with a zod schema when it's read: a misspelled setting name or a wrong value gives an error that names the file and the setting, instead of being ignored (the same rule as `.nitpilot.yml`).

## Settings that moved to the server

Plan 1's file also held `auto` (the Auto defaults for new chats) and `dailyJobCap`. From Plan 2 they live on the server and are edited on the web app's Settings page, so every laptop of yours uses the same ones ([websockets.md](websockets.md), "Settings live on the server"). An old file that still has them isn't an error: the schema takes them out before it checks the rest (`IGNORED_SETTINGS` in `config/config.ts`), they're left out of the file the next time it's saved, and `nitpilot doctor` says where they went.

## One folder per account

`NITPILOT_CONFIG_DIR` points the CLI at another folder. That's how one laptop runs two CLIs as two different GitHub accounts, which the live acceptance test needs (spec §17): `NITPILOT_CONFIG_DIR=~/.nitpilot-a nitpilot start` in one terminal, `~/.nitpilot-b` in another.

## 0600: readable by you only

The token is a password for your account, so the file gets Unix mode `0600`: the owner can read and write it, nobody else can even read it. (The three digits are owner / group / everyone; 6 means read + write, 0 means nothing.) Saving writes a new file and renames it over the old one: the rename is all-or-nothing, so a crash halfway never leaves half a config, and the new file is 0600 even if the old one wasn't.

## Environment overrides

`NITPILOT_SERVER` and `NITPILOT_TOKEN` win over the file, one setting at a time, like `.env.local` winning over `.env`. Commands that change the file read it *without* the overrides before saving, so an override never gets written into it by accident.

## One file to install

The published package is one bundled file, `dist/index.js` (`apps/cli/tsup.config.ts`). Our `@nitpilot/protocol` package isn't on npm, so tsup copies it (and zod) into the bundle, the way Vite bundles your app's imports into one script. `npx nitpilot` then downloads exactly one package.

## The React analogy

- The config file is `localStorage` for a terminal program, except we validate it on every read, like parsing an API response with zod before using it.
- Write-then-rename is the immutable update: build the new state completely, then swap it in, instead of editing the old one in place.
