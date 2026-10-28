# Plan 3: rulings and deferred minors

Extracted verbatim from the Plan 3 execution ledger (`.superpowers/sdd/2026-10-24-plan-3-deploy-and-launch/progress.md`) on 2026-10-28, before that git-ignored workspace is deleted. Branch `plan-3-deploy-and-launch`, 61fbd64..11762a5 (`v0.1.0` was tagged on `origin/main` at the merge of NikosGkikas13/nitpilot#3).

## Rulings (50)

In ledger order: every ledger line that records a ruling (mine as controller, the user's, or a reviewer's that was accepted). A line without its own task name gets the task of the ledger line before it.

1. Pre-flight: Ruling: Task 1's `registerCliRoutes` means the existing `cliRoutes(deps)`; widen its deps type with `access: RepoAccess` (app.ts already passes AppDeps) — plan text used a stale name — costs nothing if wrong.
2. Pre-flight: Ruling: Task 1 adds no request-user test; the moved check is covered by the existing cli-requests tests and the 3 new draft tests, matching the plan's 1043 count — if wrong, one small test is missing.
3. Task 1: Ruling: fix the CLI's 401 handling inside Task 1 (ServerClient reads the error code; only `unauthorized` says "run login") — the server change in Task 1 is what made `nitpilot status/retry` mislead, so it ships with it; CLI count becomes 336 instead of "unchanged" — costs one small CLI change in a server task if wrong.
4. Task 1: Ruling: Task 2's lock `onLost` fires only on an unexpected `error`/`end` — release() must not trigger it (else a clean SIGTERM shutdown would exit(1)) — plan text says "unexpectedly" but its listener on `end` alone would fire on release — costs a misleading log + exit code if wrong.
5. Task 1: Ruling: Task 2 commit uses `git add` for the new files (plan's `git commit -am` would leave client-address.ts, its test and the docs/why page out) — no cost.
6. Task 1: Ruling: Task 2 target count is server 1052 (1044 + 8 tests; plan's "about 1053" was written against 1043) — none.
7. Task 1: Ruling: Task 2's `registerCliRoutes` = `cliRoutes(deps)` (same stale name as Task 1).
8. Task 2: Ruling: the spec gets TRUST_PROXY in fix round 1 (reviewer's Minor 1) — CLAUDE.md requires spec updates in the same change, and the hosted settings line in §17 omits it — costs a few spec lines if wrong.
9. Task 2: Ruling: at the page cap apiAllPages warns and returns what it read, rather than throwing — a partial repo list only upserts (never deletes), so one install with >5000 repos still syncs the rest — costs repos past 5000 being picked up only by later webhooks if wrong.
10. Task 2: Ruling: Task 3's `wsUrlFor` = the existing private `socketUrl(server)` in apps/cli/src/connection/ws-client.ts (export it, or keep the name and export — implementer's call, say which) — stale name in the plan — none.
11. Task 2: Ruling: Task 3 count targets: protocol ~84, CLI 336 + ~7 = ~343, server 1056 + 1 = 1057 (plan's "~1054" predates Tasks 1–2's extras), e2e 6.
12. Task 3: Ruling: "the viewer has waiting drafts (view.drafts that are theirs)" = DraftView.owner === me.login and not `sending` — a draft already being sent needs no nudge — costs a banner that hides a moment early if wrong.
13. Task 3: Ruling: Task 4 follows the Plan 2 flow: implementer stops before committing; controller does the in-app browser look (e2e web server, both themes, desktop + phone); then resume to tick boxes and commit.
14. Task 3: Ruling: a draft banner's count uses plural "drafts" for N≠1 ("1 draft waits for you" / "2 drafts wait for you") — plan's "N draft(s) wait" is shorthand — none.
15. Task 4: Ruling: LICENSE is MIT (user, 2026-10-24: "go with ur pick") — Task 6 adds LICENSE + apps/cli/LICENSE, "license": "MIT" — costs a relicense commit before going public if wrong.
16. Task 4: Ruling: Task 5's implementer is sonnet (plan holds every file verbatim; work is transcription + docker runs + one docs page) — costs a fix round if wrong.
17. Task 4: Ruling: Step 6's noexec Dockerfile goes in a mktemp dir outside the repo, not "$TMPDIR" literally — same intent — none.
18. Task 5: Ruling: fix inside Task 5 — base stage installs openssl again; prod-deps bakes the schema engine in at build time; the smoke test adds an offline check (a fresh one-off `prisma migrate deploy` on an --internal network that also reaches the DB); plan text (Task 5 Dockerfile/smoke blocks, Step 5 expected lines, Checked D2 #6/#7) updated in the same fix commit — the spec says nobody builds on a server and self-hosters pull the image; a boot-time download breaks firewalled installs — costs a slightly bigger image if wrong.
19. Task 5: Ruling: finding 3's premise was wrong (base_url ends in echo, so it never aborted; a crashed server was already reported by the State.Running check), so the new `BASE=$(base_url) || fail` is a dead guard — parked as a deferred minor rather than a 4th fix round (round 4 would need a fresh, stronger implementer for a one-line deletion) — costs a misleading line in the smoke script until the final review fixes it.
20. Task 5: Ruling: Task 6 implementer is sonnet (plan holds every file verbatim; scratch ref 069f775 proves them) — costs a fix round if wrong.
21. Task 5: Ruling: implementer does Steps 1–4 only and commits at the end of Step 4; Steps 5–7 are the user's, Step 8 is a follow-up commit — per plan Checked D2 #10 — none.
22. Task 6: Ruling: the user deletes this connection now and keeps the "disallow tokens" publishing-access setting; the trusted publisher moves to D5 Task 15 as a release-day step (create it with the `npm publish` permission, then tag v0.1.0 within 48 h). Step 6 is ticked with a note; the plan's Task 6 Step 6 / Task 15 and docs/releasing.md get the 48 h + permission facts in the Step 8 follow-up commit — spec §17/§20 say an rc never publishes to npm, so validating early would mean an npm publish the spec forbids — costs one extra click-step session at D5 if wrong.
23. Task 6: Ruling: readers of GITHUB_* call a process-wide githubApp() (set once in main.ts, env fallback) instead of each taking GithubAppCredentials — threading creds through getUserToken/RepoAccess touches most of the server — costs a refactor if the user wants explicit deps.
24. Task 6: Ruling: first-run error bodies use the house shape { error: { code, message } }; Global Constraints corrected in 15b9b3f — none.
25. Task 6: Ruling: GET /first-run/callback failures redirect to /first-run?error=expired|github|exists (Task 8) instead of JSON 400/409/502 (Task 7), since it's a browser navigation — costs nothing if wrong (tests pin both).
26. Task 6: Ruling: Task 8's Playwright test runs against a second server (first-run-server.ts, ports 4321/4322, own DB) — the shared harness can't be in first-run mode — none.
27. Task 6: Ruling: the self-host Caddyfile trusts an outer proxy only via TRUSTED_PROXIES (empty by default) and rewrites X-Forwarded-For to {client_ip} — without it sign-in loops behind the tunnel — costs a Caddyfile tweak if Cloudflare's headers differ (live Step 7 checks).
28. Task 6: Ruling: Task 9 order: files + docs + local clean-folder run + commit first, then rc.2 tag (user), live run, cleanup — the tag must contain deploy/self-host — none.
29. Task 6: Ruling: gitleaks scans a --mirror --no-local clone (a worktree's .git is a file) and reports outside the repo (.superpowers/ is not git-ignored) — none.
30. Task 7: Ruling: user chose to fix minors 1 (state kept on GitHub failure) and 2 (4 KB body limit) — Task 8 rewrites the same callback (errors → redirects), so Task 8's dispatch must say the give-back on a GitHub-side failure stays and Task 8's step text context lines will differ from the plan; Task 8's diff vs scratch pin 2d53716 will differ in these lines — costs a careful Task 8 dispatch if missed.
31. Task 8: Ruling: with callback failures as redirects, a9266e2's "reload the callback to retry" is unreachable (the browser sits on /first-run?error=github, code and state gone). So the `github` redirect carries them back: `/first-run?error=github&code=…&state=…`, and the page's `github` problem offers a primary "Try again" link to `/first-run/callback?code=…&state=…` (shown only when both are present) next to "Start again"; `github` copy changes to "try again; if it keeps failing, delete the app GitHub may have made, then start again". The state is kept on `github` only; every other outcome forgets it (Task 7 tests adapted to redirects). Spec §10 and the explainer keep the retry sentence, reworded for the Try again link — why: keeps the user's a9266e2 fix working instead of silently dead — costs one extra server assertion, ~2 page tests and copy; if wrong, drop the link and the params.
32. Task 8: Ruling: expected counts move from the plan's server 1107 to 1111 (1110 after the Task 7 fixes, +1); web 373 + the Try-again tests; Playwright 21 — the implementer reports exact numbers and explains each difference.
33. Task 8: implemented by sonnet (b4a4a59, amended to fe3a358 to tick Step 20). Counts: protocol 88, CLI 349+14, server 1111, web 378 (+5 Try-again tests per ruling), root 6, e2e 6, Playwright 21; typecheck/lint clean; bundle main 499.08 kB, no warning, Settings not split. `git diff 2d53716` = the two Task 7 fixes + the ruling + migration rename only (reviewer confirmed).
34. Task 8: Ruling: user chose to fix minors 1 (explain why GitHub's code may sit in the page address) and 3 (spec "one finished callback").
35. Task 8: Ruling: Task 9 implementer is sonnet, Steps 1–5 only (files, compose validation, local clean-folder run with a locally built image, docs, suite + commit); Steps 6–8 need the user (push/tag, GHCR login, GitHub clicks) and run from the controller after review; Step 9 is a follow-up commit — same split as Task 6 — none.
36. Task 8: Ruling: expected counts are server 1111, web 378 (plan says 1107/373; +4 server from Task 7 fixes + Task 8 ruling, +5 web Try-again tests) — none.
37. Task 8: Ruling: no Task 9 doc text describes the first-run page's error outcomes except 3e's `?error=exists`, which still matches; the Task 8 `?error=github&code&state` + Try again path needs no doc change in Task 9 (the page explains itself) — costs one troubleshooting bullet later if the live run shows people need it.
38. Task 9: Ruling: user chose to fix minors 1 (pre-launch `latest`), 2 (`apps/server/.env.example` pointers: .env.example lists the six GITHUB_* names inline; getEnv's suffix also names docs/self-hosting.md for Docker installs, RED→GREEN in env.test.ts), 5 (Cloudflare/public proxies need their published ranges + port 80 firewalled), each its own commit, before the rc.2 tag — none.
39. Task 9: Ruling: the rc.2 tag goes on e98f5de (Step 5 commit + the three fixes), not fe1179b — the tag must contain the final self-host files — none.
40. Task 9: Ruling: for the live run only, the scratch override adds `platform: linux/amd64` to nitpilot (Docker Desktop emulates it); no repo change in Task 9 — multi-arch (linux/arm64 for Hetzner CAX / Pi / Macs) is an open question for the user (release.yml `platforms:` + QEMU, or document amd64-only) — costs ARM self-hosters a failed pull if left.
41. Task 9: Ruling: user agreed to publish linux/arm64 too (2026-10-24); proposed as a small D3 task after Task 10, before D4 makes the image public — pending the user's go on placement.
42. Task 9: Ruling: Task 10a (arm64 image) written into the plan after Task 10, spec §17 + §20 D3 row updated now (commit 5ef4cc4) — user's go — costs slower release builds.
43. Task 9: Ruling: Task 10 implementer is sonnet (plan holds .gitleaks.toml + CI job verbatim; checkpoint 78c1902) — costs a fix round if wrong.
44. Task 9: Ruling: the history now has Tasks 7–9's real commits (same content as the scratch refs, different commit ids) plus fixes, so Step 1 may count more than 14: an extra finding with the same rule + file + test value as a listed row (another commit) is expected, not a STOP; a new file/rule/value is a STOP (file/commit/rule only) — gitleaks reports per commit — costs a pause if wrong.
45. Task 9: Ruling: the `dir` scan runs on a copy of tracked + untracked-not-ignored files (`git ls-files -co --exclude-standard`), never the raw folder, because apps/server/.env (real secrets, git-ignored) is present — the brief's own fallback — none.
46. Task 10: Ruling: user chose minors 1 (digest pin) and 2 (permissions: contents: read), one commit each; plan's Task 10 code block updated in the same commit so plan and file agree. fix round 1/5 dispatched (resume implementer), FIX_BASE a84453d
47. Task 10: Ruling: implementer is sonnet for Steps 1–3 (edits verbatim in the brief; long emulated build) — costs a fix round if wrong.
48. Task 10: Ruling: Step 2's emulated build/smoke may fail only on a timing check; that is recorded and accepted per the plan; any other failure stops — none.
49. Task 10a: Ruling: user chose to fix the shared-cache minor before the rc.3 tag; release.yml's cache-from/cache-to get scope=release (ci.yml keeps the default scope), own commit; the plan's Task 10a code blocks don't show the cache lines, so no plan text change — none. fix round 1/5 dispatched (resume implementer), FIX_BASE 2b9cf74
50. Task 10a: Ruling: revert 80b91c2 (own commit, before the rc.3 tag) — the fix's benefit can't happen with per-ref caches and it loses main's warm amd64 layers; the real cure (seed a release-scope cache from main, or native ARM runners) is more machinery than a rare release job deserves — costs a slow, mostly cold arm64 half on every release, which was already the case. fix round 2/5 dispatched (resume implementer), FIX_BASE 80b91c2

## Decisions and open items from Tasks 12–14

The ops and live-run tasks recorded these as status lines rather than `Ruling:` lines.

- Task 12 deviations: (1) user's `!`-prompt cat of .env put DATABASE_URL in chat -> password rotated on the box (ALTER ROLE via stdin, set_env, force-recreate); user asked to re-save .env (not confirmed when committed). (2) Odyhook's deploy (next build on the box, no swap) froze the box ~10:20-10:45 UTC; GitHub cancelled at 15 min; user power-cycled in Hetzner; all containers back, Caddy read the new file at boot (no manual restart). Odyhook's NEXT deploy will hit the same: owner decision pending (swap / build in CI / bigger box). (3) First app came out as nitpilot-nitpilot-dev, private (name not changed): user deleted it on GitHub, I deleted GithubAppConfig + RawEvent rows and restarted; second try right. (4) User asked me to read the setup code over ssh (shown in chat; single-use, dead once the app exists). (5) I pushed the Odyhook branch and opened the PR (plan had the user do it); user merged. Docs: hosting.md (Memory: Odyhook builds on the box; .env copy in an own terminal + rotating a leaked DB password; app name/visibility check + redo), plan Steps 6/7/8/9 text.
- Task 13 open: (1) Mac Chrome didn't show the Ready push (iPhone did; server no push failure) — not diagnosed. (2) Demo not recorded: first take unusable (Claude app on screen, personal tabs); retake needs single-player but ngkdev93-jpg has a User row now → user moved demo to D5 (needs ngkdev93-jpg removed from nitpilot.dev, or another author account). (3) No GitHub app badge on user-token reviews — spec/runbook text fixed. ngkdev93-jpg CLI config ~/.nitpilot-hosted-w kept; NikosGkikas13 config back on claude-code. Unusable take still at ~/Desktop/Screen Recording 2026-10-25 at 1.23.12 PM.mov (user's file).
- Task 14: complete except Step 4 (user) (2026-10-25). Demo dropped first in eaf19e2 (user's decision: plan Task 13/14, spec §20 item 4, runbook §4 + Results). Task 14 written at step level + 'Checked against the code (D5)' against eaf19e2. README rewritten (launch story in words, install, teammate, what to know: no app badge / single-player needs author off Nitpilot / public repos only, how it works, self-host, security with SCRUB_PATHS, dev, license); apps/cli/README.md (npm pack lists it); architecture §2/§4.6/§4.12/§6 + new §4.14 deploying; no-app-badge fixed in spec §6.1 + why/oauth-pkce.md; hosting.md past tense. Path/link check clean, lint ok. Open: user enables private vulnerability reporting on the repo and reads the README rendered after pushing; README links to /security/advisories/new.

Two more, from the plan's "Checked against the code (D5)" (user's rulings, 2026-10-25): single-player for the npm check was made by deleting ngkdev93-jpg's `User` row on nitpilot.dev rather than adding a third account; and the final review ran after the `v0.1.0` tag, so its fixes ship as `0.1.1`.

## Deferred minors (68)

In ledger order: every ledger line that defers something or leaves it open. Many were closed by a later fix round (the ledger line that closed it follows it, or a ruling above records it).

- Task 1: minor (deferred): over-long doc lines in chat-drafts.ts / cli.ts comments
- Task 1: minor (deferred): no 502 github_unavailable test on /api/me/chats
- Task 1: minor (deferred): cli.ts imports rowsInReposYouCanRead from routes/inbox.ts (could move to chats/repo-filter.ts)
- Task 1: minor (deferred): /api/me/chats takes 100 rows before the repo filter (same as inbox)
- Task 1: minor (deferred): CLI reauth message reads a bit repetitive ("…Sign in again. Sign in at <url>/"); no test pins the suffix or a non-JSON 401 body
- Task 1: minor (deferred): one orphan short line in chat-drafts.ts' re-wrapped comment; repo-filter.ts signature and the CLI reauth throw run past 120 columns
- Task 2: minor (deferred): apiAllPages has no page cap / repeat guard
- Task 2: minor (deferred): purge test doesn't assert jobs/tasks gone (cascade makes it safe)
- Task 2: minor (deferred): docs/why/trusting-a-proxy.md says Caddy appends to XFF; by default it replaces an untrusted incoming one
- Task 2: minor (deferred): lock tests use fixed 100ms sleeps to prove a non-event
- Task 2: minor (deferred): retention purge first runs an hour after boot (same as purgeOldRows)
- Task 3: minor (deferred): stale "GitHub logins ignore case" comment in read.test.ts
- Task 3: minor (deferred): a query/hash on the server address ends up wrapping the joined path (config accepts it)
- Task 3: minor (deferred): you.githubId could be z.string().min(1) as defence in depth
- Task 3: minor (deferred): no test that ServerClient / status / doctor links keep the path prefix
- Task 3: minor (deferred): `http://remote/x?a=1` shows two config messages (both true; cosmetic)
- Task 4: minor (deferred): Review-drafts scroll target uses permissions.drafts (+ fallback to view.drafts[0]) while the count uses myWaitingDrafts — two rules for "my drafts"
- Task 4: minor (deferred): failureReasonOf looks across all flagged roles while failureKind decides per role (rare multi-role mismatch); could be one query
- Task 4: minor (deferred): stale_head sentence only fits the worktree case, not the push case
- Task 4: minor (deferred): ChatBanner test leaks an Element.prototype.scrollIntoView stub; fixture has a reviewer owning author drafts
- Task 4: minor (deferred): duplicate @nitpilot/protocol import in banner.test.ts
- Task 4: minor (deferred): two different functions named failureOf (activity.ts private vs failed-flags.ts export)
- Task 4: minor (deferred): Review drafts does nothing if the draft card is outside the rendered feed (older than the newest 200 items)
- Task 5: minor (deferred): pg_isready over the unix socket can pass during the postgres image's temporary init server (use -h 127.0.0.1)
- Task 5: minor (deferred): 1012 check races the hub's 10 s hello timeout (size/stats taken after the socket opens)
- Task 5: minor (deferred): an early crash makes base_url abort under set -e with no FAIL line or log
- Task 5: minor (deferred): memory check runs uncapped, not with --memory 384m like the hosted container
- Task 5: minor (deferred): HEALTHCHECK --start-interval needs Docker Engine 25+ (worth a comment)
- Task 5: minor (deferred): docs/why/docker-images.md says "no compilers" but the image ships tsx/esbuild
- Task 5: minor (deferred): build-time engine postinstall exits 0 on a failed download (guard with `&& ls node_modules/@prisma/engines/schema-engine-*`)
- Task 5: minor (deferred): the offline migrate container has no --name, so cleanup can't remove it after a Ctrl-C
- Task 5: minor (deferred): Checked D2 #4 still calls the docker-start restart the "second boot" check without saying it isn't a fresh container
- Task 5: minor (deferred): `BASE=$(base_url) || fail …` in image-smoke.sh can never fire (drop it, or read the port into a variable first); docker port's stderr is unredirected
- Task 6: minor (deferred): docs/releasing.md says CI runs "on every push" and "let CI go green" — CI runs only on PRs and pushes to main
- Task 6: minor (deferred): docs/why/releasing.md's npm pre-release example (^0.9.0 vs 1.0.0-rc.1) doesn't show pre-release skipping (use 0.9.1-rc.1)
- Task 6: minor (deferred): docs/why/releasing.md says :0.1.0 "never changes"; docs/releasing.md rightly says image tags can be overwritten
- Task 6: minor (deferred): docs/why/releasing.md's Vercel deploy-hook analogy is a poor fit for trusted publishing
- Task 6: minor (deferred): release.yml version and npm jobs have no timeout-minutes
- Task 6: minor (deferred): release.yml pushes an image that was never smoke-tested; nothing checks CI passed on the tagged commit (rc-first process covers it)
- Task 6: minor (deferred): check-release-version tests leave temp dirs, lack a v0.2.0-rc.1 mismatch case, and "says undefined" when CLI_VERSION isn't found
- Task 6: minor (deferred): docs/why/releasing.md mentions "a new digest" without saying what a digest is
- Task 6: minor (deferred): GitHub warns actions/checkout@v4, setup-node@v4, docker/*-action@v3/v6 target Node 20 (deprecated, forced onto Node 24); bump to their Node 24 majors in both workflows
- Task 7: minor (deferred): first-run callback consumes `state` before convertManifest; a transient GitHub 5xx forces a restart and leaves an orphan app on GitHub (first-run.ts states.take before convert).
- Task 7: minor (deferred): scripts/record-fixtures.ts still reads process.env.GITHUB_WEBHOOK_SECRET (deliberately unchanged per deviation 14: dev-only fixture scrubber).
- Task 7: minor (deferred): POST /api/first-run/manifest has no body size limit before c.req.json() (rate-limited 5/min; other JSON routes have none either).
- Task 7: minor (deferred): first-run exit test times a real 500 ms timer (>= 490 ms) instead of fake timers.
- Task 7: minor (deferred): 413 test covers only the Content-Length path, not a chunked body (hono's bodyLimit handles it).
- Task 8: minor (deferred): GitHub's one-hour single-use manifest code now also sits in /first-run?error=github&code=… (history, proxy logs); explainer doesn't say why that's acceptable.
- Task 8: minor (deferred): first-run.db.test.ts "never stores an app with a secret missing" asserts exit not called right after the callback; exit is 500 ms later, so it can't fail (plan-mandated, in checkpoint).
- Task 8: minor (deferred): spec §10 manifest bullet says state is "good for one callback"; callback bullet and explainer say "one finished callback".
- Task 8: minor (deferred): main bundle 0.9 kB under Vite's 500 kB warning — next task adding to the main chunk should lazy-load Settings.
- Task 8: minor (deferred): Approve.test.tsx ends with a stray blank line.
- Task 8: minor (deferred): no Playwright spec for the Try again path (stand-in GitHub has no failing mode); covered by server + page unit tests.
- Task 8: minor (deferred): the "Why `state`" paragraph is now one long block; could be split. Server sets no Referrer-Policy of its own (relies on browser default strict-origin-when-cross-origin).
- Task 9: minor (deferred): self-hosting.md curls from main + image :latest, which doesn't exist on GHCR until v0.1.0 (pre-launch readers fail to pull).
- Task 9: minor (deferred): deploy/self-host/.env.example and getEnv's "See apps/server/.env.example." point self-hosters at a file they don't have.
- Task 9: minor (deferred): reverse-proxy-and-tls.md mentions "the clean-folder run" (dev history in a reader-facing explainer).
- Task 9: minor (deferred): `ports: !override` needs Compose ≥ 2.24.4; no version note.
- Task 9: minor (deferred): "Behind another HTTPS proxy" implies private_ranges works for Cloudflare orange-cloud; public proxies need their published IP ranges + port 80 firewalled to them.
- Task 9: minor (deferred): Linux userland-proxy IPv6 visitors can appear as a private gateway address; the loopback/firewall warning covers it — keep it prominent.
- Task 9: minor (deferred): self-hosting.md's Cloudflare TRUSTED_PROXIES example contains a literal `…` placeholder.
- Task 10: minor (deferred): gitleaks image pinned by tag only (ci.yml:116); the plan records the digest — pin `v8.30.1@sha256:c00b6bd0…`.
- Task 10: minor (deferred): ci.yml has no `permissions:` block; the token gets repo defaults (add `contents: read`).
- Task 10: minor (deferred): three allowlists match on key name (`^privateKey: `, `^auth: `, `^SMOKE_TOKEN_HASH=`), so another value on such a line in those files would be hidden; SMOKE_TOKEN_HASH also covers the still-edited Plan 3 file.
- Task 10: minor (deferred): the plan's local scan commands (Task 10 Steps 1, 2, 4) still use the tag-only gitleaks image; harmless, could pin for consistency.
- Task 10a: minor (deferred): native ubuntu-24.04-arm runner (matrix + manifest merge) instead of QEMU — more machinery; at most a future note.
- Task 10a: minor (deferred): release and CI share the default type=gha cache scope, so each can evict the other's layers (arm64 layers may not stay cached); `scope=release` on the release cache would keep them apart. Efficiency only.
- Fix chunk 3 done in ab9812f: SIGTERM handler registered after serve() with a stopping flag; stop_grace_period: 30s in both compose files. Image smoke PASS (exit 0 in 0s, 1012); compose config ok; suite unchanged (server 1112). Minor kept: the boot-window stop has no automated test (apiBase fixed). Deploy note: copy deploy/hosted/docker-compose.yml to /opt/nitpilot with the 0.1.1 deploy.

## Final review (2026-10-28)

One opus reviewer over `61fbd64..b30bc0f` against the spec, the plan's Global Constraints and its Review Focus. No critical findings. All five Review Focus conditions checked and found covered: a stranger reaching first-run first (`setup/first-run.ts`, `setup/setup-code.ts`), half-set credentials or an unreadable stored app (`lib/env.ts`, `setup/credentials.ts`), `TRUST_PROXY` and `X-Forwarded-For` (`lib/client-address.ts`), a restart mid-job (`main.ts`, `Dockerfile`, `scripts/image-smoke.sh`), and Postgres going away under the lock (`lib/advisory-lock.ts`).

Three findings, all fixed at the user's pick ("fix all three"), one commit each, each with the full suite green:

1. **Important, bf303c4:** the release check and `docs/releasing.md` ignored `SERVER_VERSION` (`apps/server/src/version.ts`), so a `v0.1.1` image would have reported `0.1.0` in `/healthz` and `nitpilot doctor`. `scripts/check-release-version.mjs` now checks all three version files; a test was added.
2. **Minor, 11762a5:** two loads of the first-run callback with one `state` (a refresh while the first was talking to GitHub) both asked GitHub; the second got a 404 for the used code and showed "Nothing was saved" although the app was saved. A callback in progress is now kept by state, and a second load gets its answer. Test added (red, then green).
3. **Minor, ab9812f:** the SIGTERM handler was registered only after boot recovery, and Docker's default 10 s stop is shorter than one 15 s GitHub call. The handler now goes on right after the server listens (a `stopping` flag keeps boot from starting what shutdown stopped), and both compose files set `stop_grace_period: 30s`. Verified with the image smoke test and `docker compose config`.

Left open after the review:

- The stop-during-boot path has no automated test: `GithubClient.apiBase` is fixed, so a test can't stall recovery's call to GitHub. The image smoke test covers the stop after boot.
- The Mac's Chrome didn't show the *Ready for your approval* push in Task 13 (the iPhone did); not diagnosed.
- `0.1.1` isn't released yet. It needs all three version files bumped, and its deploy must also copy `deploy/hosted/docker-compose.yml` to `/opt/nitpilot` (the new `stop_grace_period`).
