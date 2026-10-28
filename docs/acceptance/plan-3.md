# Plan 3 acceptance run (live, on nitpilot.dev)

The manual end-to-end test of the hosted instance, from [spec §20](../superpowers/specs/2026-10-07-nitpilot-design.md) item 4 ("Plan 3 acceptance test"): the real https://nitpilot.dev on the Hetzner box, the production GitHub App `nitpilot`, real GitHub, two real accounts, a phone, and Claude Code. No tunnel and no local server: every CLI talks to nitpilot.dev, the CLI's default. Follow it top to bottom and tick the boxes. [why/live-acceptance.md](../why/live-acceptance.md) explains why this is a document and not a test.

**Time:** about 2 hours. **Cost:** about 3 Claude Code runs of your Claude plan (section 3, and one or two in section 6; section 4 was dropped). Sections 7 and 8 use the scripted fake agent and cost nothing. If a run ends with a `quota` failure, wait for the plan's window to reset and carry on.

## Who is who

| Account | Role | CLI | Agent | Where you click |
|---|---|---|---|---|
| `NikosGkikas13` | reviewer, owns the sandbox repo and the `nitpilot` app | `nitpilot` (the built CLI) in sections 2–3; `nit-rf` (from source) in sections 6–7 | **Claude Code**, then the **fake agent** | **NikosGkikas13's browser**: your normal Chrome window, signed in to GitHub as `NikosGkikas13`; and **NikosGkikas13's iPhone** |
| `ngkdev93-jpg` | author | none until section 6, then `nit-w` (the built CLI) | **Claude Code** (section 6) | **ngkdev93-jpg's browser**: a Chrome private window (⇧⌘N) signed in to GitHub as `ngkdev93-jpg` |

Section 3 is the launch story: one person on Nitpilot, the reviewer, while the author is just someone on GitHub. In section 6 the author joins too and the two agents work it out in the chat. There the reviewer's agent is the fake one and the author's is Claude, as in Plan 1: the fake reviewer raises the same three points every time, so the author's Claude has something definite to fix, and a run never depends on how many points a real reviewer happens to raise.

The sandbox is `NikosGkikas13/nitpilot-sandbox`, with `ngkdev93-jpg` as a collaborator, and the clones from [plan-1.md](plan-1.md) section 1: `~/nitpilot-acceptance/a/nitpilot-sandbox` (ngkdev93-jpg, over `github-a`) and `~/nitpilot-acceptance/b/nitpilot-sandbox` (NikosGkikas13, over `github-b`).

**Terminals:** **T1** NikosGkikas13's CLI, **T2** ngkdev93-jpg's CLI (from section 6), **T3** commands. In each, first run `cd /path/to/nitpilot && source docs/acceptance/hosted.sh`. It defines `nitpilot`, `nit-rf`, `nit-w`, `nit-edit`, and two read-only views of the box: `boxq` (psql on nitpilot.dev's database) and `boxlog` (the server's log).

**If something goes wrong**, stop and keep the evidence: a screenshot, the T1/T2 output, `boxlog 200`, and `check.sql`'s output. A bug found here gets a failing test first and a fix after; don't patch it live and carry on. A fix to the server reaches nitpilot.dev only through a new `rc` image and a deploy ([hosting.md](../hosting.md), "Deploying a new version").

**Ask before:** every step that writes to GitHub (each PR, each review request, the private repo in section 8), each Claude Code run, turning push on, and the restart in section 7 (it restarts nitpilot.dev).

---

## 0. Before you start

- [x] nitpilot.dev is up: `curl -s https://nitpilot.dev/healthz` prints `{"ok":true,"version":"0.1.0"}`, and `boxlog 5` (it asks the box over ssh) shows no error.
- [x] The production app is installed on the sandbox: `boxq -c 'select slug, "ownerLogin" from "GithubAppConfig"' -c 'select "fullName", private from "Repo"'` prints `nitpilot | NikosGkikas13` and a row `NikosGkikas13/nitpilot-sandbox | f`.
- [x] Claude Code is signed in: `claude auth status` prints `"loggedIn": true`.
- [x] The tools exist: `command -v jq perl gh git node ssh` prints six paths.
- [x] The CLI is built from this branch: `npm run build -w apps/cli`, then `nitpilot --version` prints `0.1.0`.
- [x] Nothing points the CLI elsewhere: `echo "${NITPILOT_SERVER:-unset}"` prints `unset`, and `ls ~/.nitpilot-hosted-r ~/.nitpilot-hosted-w` finds neither folder (each person starts fresh).
- [x] Plan 1's one-time setup is still there: `ssh -T git@github-a` greets `ngkdev93-jpg`, `ssh -T git@github-b` greets `NikosGkikas13`, both clones exist (`ls "$CLONE_A" "$CLONE_B"`), and clone A's commits are ngkdev93-jpg's: `git -C "$CLONE_A" config user.email` prints `340081894+ngkdev93-jpg@users.noreply.github.com`.
- [x] `gh` knows both accounts: `gh auth status` lists `NikosGkikas13` and `ngkdev93-jpg`.
- [x] macOS lets Chrome show notifications: System Settings → **Notifications** → **Google Chrome** → *Allow notifications* is on.

## 1. The addresses (no clicks)

Already checked when nitpilot.dev went live (Plan 3 Task 12); repeat it here so the results are in one place.

**T3:**
```bash
curl -sI http://nitpilot.dev | grep -iE '^(HTTP|location)'
curl -sI https://www.nitpilot.dev | grep -iE '^(HTTP|location)'
curl -sI http://www.nitpilot.dev | grep -iE '^(HTTP|location)'
curl -s https://nitpilot.dev/healthz; echo
echo | openssl s_client -connect nitpilot.dev:443 -servername nitpilot.dev 2>/dev/null | openssl x509 -noout -subject -issuer -enddate
```
Expect: `308` (or `301`) to `https://nitpilot.dev/`; `301` to `https://nitpilot.dev/`; a redirect that ends at `https://nitpilot.dev/` (http → https first, then to the apex); the health answer; and a certificate for `CN=nitpilot.dev` from Let's Encrypt with an end date about three months away.

- [x] `http://nitpilot.dev` and `www.nitpilot.dev` (http and https) end at `https://nitpilot.dev`, with a valid certificate.

## 2. NikosGkikas13 connects a CLI (about 5 minutes)

NikosGkikas13 signed in to nitpilot.dev when installing the app (Task 12), so only the CLI is new.

1. **T1:** `nitpilot login`. It prints a link and a code and opens your default browser (**NikosGkikas13's browser**). On **Approve this device?** (on `https://nitpilot.dev/…`) check the code is the one in T1 and click **Approve**. T1 prints `Logged in as NikosGkikas13.`
2. **T1:** link the clone and check:
   ```bash
   nitpilot repos add "$CLONE_B" && nitpilot doctor
   ```
   Expect `repos add` to confirm `NikosGkikas13/nitpilot-sandbox` is linked to that clone, and `doctor` to print no `✗` line.
3. **T1:** `nitpilot start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. Expect `Connected as NikosGkikas13. Linked: NikosGkikas13/nitpilot-sandbox.` Leave it running.

- [x] `nitpilot login` and `start` work against nitpilot.dev with no `NITPILOT_SERVER` and no tunnel.

## 3. Single-player reviewer (the first PR; one Claude run)

The launch story: ngkdev93-jpg, who isn't on Nitpilot, asks NikosGkikas13 for a review, and NikosGkikas13's own agent posts it within seconds.

1. **T3** (say first: pushes a branch as ngkdev93-jpg):
   ```bash
   cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" hosted-reviewer; cd "$REPO"
   ```
   Expect `Branch pushed. Open the pull request as account A:` and a link.
2. **ngkdev93-jpg's browser:** open that link. GitHub's **Open a pull request** page compares `acc/hosted-reviewer` with `main`. Click the **Title** box and type `Hosted: reviewer`. Don't pick a reviewer yet. Click the green **Create pull request** button. Note the number (`#<PR>` after the title); in **T3** run `export PR=<number>`.
3. Wait about ten seconds (so the PR's own webhooks are done), then, still in **ngkdev93-jpg's browser**, on the PR's **Conversation** tab: in the right-hand column click the gear next to **Reviewers**, type `NikosGkikas13`, click the name (a tick appears), and click outside the list. **Reviewers** now shows NikosGkikas13 with a small dot (requested).
4. Within about 5 seconds **T1** prints `→ review of NikosGkikas13/nitpilot-sandbox#<PR> (attempt 1)`. Claude works for one to three minutes; then `✓ review of …: done`.
5. **ngkdev93-jpg's browser:** reload the PR. A review by **NikosGkikas13** (your name and avatar; GitHub shows no app badge on a review posted with a user's token, seen in the Plan 3 run), and inline comments on `orders-demo/src/orders.js` (the seed has three planted bugs; Claude usually finds them and may add others). No comment from `nitpilot[bot]` (only one side is on Nitpilot).
6. **T3:**
   ```bash
   boxq -v pr=$PR -f - < docs/acceptance/check.sql
   gh api repos/$SANDBOX/pulls/$PR/reviews --jq '[.[] | {user: .user.login, state, submitted_at}]'
   gh api repos/$SANDBOX/issues/$PR/comments --jq '[.[] | .user.login]'
   ```
   Compare the `review_requested` arrival time in `check.sql` section 4 with the `→ review of …` stamp in T1 (both UTC).

- [x] The review job started within 5 seconds of "Request review" (`check.sql` §4 `pull_request.review_requested` against T1's `→ review` stamp).
- [x] The review is on the PR in NikosGkikas13's name; no `nitpilot[bot]` comment.
- [x] Every webhook was processed or ignored (`check.sql` §5), and no job ran twice (§3 prints no rows).

## 4. The demo recording (dropped)

Dropped by the user's decision on 2026-10-25: there is no demo video, and the README tells the launch story in words ([spec §20](../superpowers/specs/2026-10-07-nitpilot-design.md) item 4). The one take, on #18, was unusable (it showed the Claude app instead of the terminal, plus a personal inbox and bookmarks), and a retake needed a fresh single-player PR, which ngkdev93-jpg's joining in section 6 rules out. Nothing to do here; go on to section 5.

## 5. Push on desktop Chrome and on the iPhone (about 10 minutes)

Ask first: turning push on registers each browser with its push service (Google's for Chrome, Apple's for the iPhone). Unlike Plan 2, there is no callback address to add for the run: `https://nitpilot.dev` is the app's own address for good.

1. **NikosGkikas13's browser**, on https://nitpilot.dev/inbox: click your avatar at the top left beside the Nitpilot wordmark (*Settings · NikosGkikas13*). In the **Notifications** card click the **Push notifications** switch (grey). Chrome shows *nitpilot.dev wants to Show notifications* under the address bar: click **Allow**. The switch turns blue.
2. **NikosGkikas13's iPhone:** open **Safari**, type `https://nitpilot.dev` (with the `https://`), tap **Sign in with GitHub** and sign in as `NikosGkikas13`; GitHub asks once to **Authorize nitpilot**. You land in the inbox.
3. Tap **Share** (the square with an arrow up, in the bottom bar) → scroll down → **Add to Home Screen** → **Add**.
4. Go to the Home Screen and open the new **Nitpilot** icon. If it shows the landing page, tap **Sign in with GitHub** again inside it (it keeps its own cookies).
5. Tap your avatar → **Settings** → **Notifications** → the **Push notifications** switch → **Allow**.
6. **T3:** `boxq -v pr=0 -f - < docs/acceptance/check-web.sql`. Section 4 lists two rows for `NikosGkikas13`: *Chrome on macOS* and *Safari on iPhone*.

- [x] Push is on in NikosGkikas13's Chrome and in the iPhone's Home Screen app (two subscriptions in `check-web.sql` §4), with no callback URL added anywhere.

## 6. Agent to agent (the third PR; one or two Claude runs)

ngkdev93-jpg joins, with Claude Code fixing; NikosGkikas13's agent becomes the fake reviewer.

1. **ngkdev93-jpg's browser:** open https://nitpilot.dev and click **Sign in with GitHub**; on GitHub click **Authorize nitpilot**. You land on the setup checklist.
2. **T2:** `nit-w login --no-open`. Copy the link it prints into **ngkdev93-jpg's browser**, check the code, click **Approve**. T2 prints `Logged in as ngkdev93-jpg.`
3. **T2:** `nit-w repos add "$CLONE_A" && nit-w doctor` (no `✗`), then `nit-w start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. Expect `Connected as ngkdev93-jpg.`
4. **T1:** stop the CLI (Ctrl-C), switch NikosGkikas13 to the fake agent and start it from source:
   ```bash
   nit-edit r '.agent = "fake"' && unset R_SCENARIO && nit-rf start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
   Expect `Connected as NikosGkikas13.`
5. **T3** (say first: a branch, then Claude runs on ngkdev93-jpg's side): `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" hosted-pair; cd "$REPO"`. In **ngkdev93-jpg's browser** open the link, title `Hosted: agent to agent`, and this time pick the reviewer before creating it: the gear next to **Reviewers** → `NikosGkikas13` → click outside → **Create pull request**. `export PR=<number>` in **T3**.
6. Expect, with no clicks:
   - **T1** within 5 seconds: `→ review of …#<PR>`, then `✓ review … done` (three points, a second or two).
   - GitHub: one comment from **`nitpilot[bot]`** (the summary) a few seconds later.
   - **T2** a few seconds after the review (3 s in the Plan 3 run): `→ address of …#<PR> (attempt 1)`; Claude edits `orders.js`, replies to each point, and a commit lands on the branch; `✓ address … done`.
   - **T1:** `→ re_review of …`, `✓ … done` (all three resolved).
   - The chat is ready: **NikosGkikas13's Mac** shows a notification from **Google Chrome** titled *Ready for your approval* (top right); click it and Chrome opens the chat. **NikosGkikas13's iPhone** shows the same from **Nitpilot**; tap it and the Home Screen app opens the chat. T1 prints a `🔔 Ready for your approval …` line, and no notification from **Script Editor** appears on the Mac (that's the CLI's fallback when push didn't reach you).
7. **T3:**
   ```bash
   boxq -v pr=$PR -f - < docs/acceptance/check.sql
   gh api repos/$SANDBOX/issues/$PR/comments | jq --arg link "/c/$SANDBOX/$PR" '[.[] | select(.user.login == "nitpilot[bot]")] | {bot_comments: length, edited: (.[0].updated_at != .[0].created_at), has_log: (.[0].body | contains("<summary>Review log")), has_transcript_link: (.[0].body | contains($link))}'
   gh api repos/$SANDBOX/pulls/$PR/commits --jq '[.[] | {sha: .sha[0:7], author: .author.login, message: .commit.message}]'
   ```
   Expect `check.sql` §1 phase `ready`; the `jq` line `bot_comments: 1` with `edited`, `has_log` and `has_transcript_link` all `true`; and every commit's `author` `ngkdev93-jpg`.

- [x] The chat reached READY with exactly one `nitpilot[bot]` summary comment, edited across rounds.
- [x] The fix commit is authored by ngkdev93-jpg.
- [ ] Web Push arrived on desktop Chrome and on the iPhone Home Screen app, and clicking it opened the chat; the CLI showed no OS notification.

## 7. A restart in the middle of a job (the fourth PR; no Claude run)

`docker compose restart` on the box while NikosGkikas13's agent is in the middle of a review. The fake reviewer waits 45 seconds before it raises its points (`scenarios/sandbox-slow.json`), which leaves time to restart.

1. **T2:** stop ngkdev93-jpg's CLI (Ctrl-C), so no Claude address job starts in this section.
2. **T1:** stop the CLI and start it on the slow scenario:
   ```bash
   R_SCENARIO="$REPO/docs/acceptance/scenarios/sandbox-slow.json" nit-rf start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
3. **T3** (say first: a branch): `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" hosted-restart; cd "$REPO"`. **ngkdev93-jpg's browser:** open the link, title `Hosted: restart`, pick **NikosGkikas13** under **Reviewers**, **Create pull request**. `export PR=<number>`.
4. The moment **T1** prints `→ review of …#<PR> (attempt 1)`, in **T3** (say first: restarts nitpilot.dev):
   ```bash
   ssh $BOX 'cd /opt/nitpilot && docker compose restart && docker compose ps --format "{{.Name}} {{.Status}}"'
   ```
   Expect `Container nitpilot-server  Restarting`, `Started`, and a status line. **T1** shows the connection dropping (`Disconnected (1012 server restarting)`, maybe a `Disconnected (1006)` while the server starts) and, within a few seconds, `Connected as NikosGkikas13.` again, with no `■ Stopped` and no new `→ review` line.
5. About 45 seconds after the job started, **T1** prints `✓ review of …: done`. ngkdev93-jpg is on Nitpilot since section 6, so this is an agent-to-agent chat: the three points go to the chat and to the `nitpilot[bot]` summary comment, not to a GitHub review. Their address job stays `queued` (their CLI is stopped) until the PR is closed in section 10.
6. **T3:** `boxq -v pr=$PR -f - < docs/acceptance/check.sql` and `ssh $BOX 'cd /opt/nitpilot && docker compose logs -t --since 5m nitpilot-server'`. The server logs nothing when it stops; the log shows the new start (`listening`, `[boot] re-ran …`) at the restart's time, and T1's `1012 server restarting` shows the clean stop.

- [x] The restart lost nothing: one `review` job, `done` at attempt 1 (`check.sql` §2), no duplicates (§3), the three points in the chat (§6) and the summary comment, and the CLI reconnected by itself after a `1012`; the log shows the new start.

## 8. A webhook from a private repo is dropped (no agent runs)

The hosted instance takes public repos only (`PUBLIC_REPOS_ONLY=true`). Ask first: this makes a private repo on NikosGkikas13's account, installs the app on it and opens a PR there.

1. **T3:** make the repo with one commit on `main` and a branch:
   ```bash
   gh repo create NikosGkikas13/nitpilot-private-check --private --add-readme --description "Plan 3 acceptance: a private repo the hosted instance must ignore"
   gh api -X PUT repos/NikosGkikas13/nitpilot-private-check/contents/check.txt -f message="Add check.txt" -f content="$(printf 'private\n' | base64)" -f branch=main
   ```
   That makes the repo (and `README.md` on `main`) and adds a file. Then a branch with a change, and its PR:
   ```bash
   sha=$(gh api repos/NikosGkikas13/nitpilot-private-check/git/ref/heads/main --jq .object.sha)
   gh api repos/NikosGkikas13/nitpilot-private-check/git/refs -f ref=refs/heads/check -f sha="$sha"
   blob=$(gh api repos/NikosGkikas13/nitpilot-private-check/contents/check.txt --jq .sha)
   gh api -X PUT repos/NikosGkikas13/nitpilot-private-check/contents/check.txt -f message="Change check.txt" -f content="$(printf 'private, changed\n' | base64)" -f branch=check -f sha="$blob"
   ```
2. **NikosGkikas13's browser:** install the app on it. Open https://github.com/settings/installations, click **Configure** next to **nitpilot**. Under **Repository access** (**Only select repositories** is already chosen), click **Select repositories**, type `nitpilot-private-check`, click it, and click **Save** at the bottom. GitHub may ask for your password or a code first.
3. **T3:** open the PR, asking for no review (there's nobody else on this repo):
   ```bash
   gh pr create -R NikosGkikas13/nitpilot-private-check --head check --base main --title "Private check" --body "Must be dropped by nitpilot.dev."
   ```
4. **T3**, after about 10 seconds:
   ```bash
   boxq -c "select event, action, status, note from \"RawEvent\" where body::jsonb -> 'repository' ->> 'full_name' = 'NikosGkikas13/nitpilot-private-check' order by \"createdAt\"" -c "select \"fullName\", private from \"Repo\" where \"fullName\" like '%private-check'" -c "select count(*) as chats from \"PrChat\" c join \"Repo\" r on r.id = c.\"repoId\" where r.\"fullName\" like '%private-check'"
   ```
   Expect the `installation_repositories` / `pull_request` rows for that repo `ignored` with the note `private repo (public-only mode)` (an `installation_repositories` delivery carries no `repository` field, so it may not be listed), and `0` chats. The `Repo` query may list the repo with `private` `t` (the installation sync records it); what matters is that nothing about its PR got through.
5. Remove the repo again, **NikosGkikas13's browser**: open https://github.com/NikosGkikas13/nitpilot-private-check/settings, scroll to the red **Danger Zone** at the bottom, **Delete this repository**, confirm the steps GitHub shows (it asks you to type `NikosGkikas13/nitpilot-private-check`), and click the red delete button. (GitHub also removes it from the app's installation.)

- [x] The private repo's PR webhooks were stored as `ignored` (`private repo (public-only mode)`), and no chat or job came from them.

## 9. Backups, memory, and Odyhook (no clicks)

1. **T3:** a backup of what this run made, then the restore check (both on the box; "say first" covers the scratch database it makes and drops):
   ```bash
   ssh $BOX '/usr/local/bin/nitpilot-backup.sh'
   ```
   Expect (the script prints its line; `/var/log/nitpilot-cron.log` only exists after cron's first 03:30 run) `nitpilot-backup: ok r2:odyhook-backups/nitpilot/nitpilot-<time>.sql.gz (<n> bytes)`. Then the commands under "Check a backup" in [hosting.md](../hosting.md), on the box (`ssh $BOX`, paste them, `exit`). Expect the two count lines to match: the same number of migrations, people (`User`: 2 now), chats (this run's four PRs, plus Task 12's), and `1` app.
2. **T3:** the cron line is in place: `ssh $BOX "grep -c '^30 3 ' /etc/cron.d/nitpilot"` prints `1` (the file's comment names the script too). If a night has passed since Task 12, the log shows an `ok` line from 03:30 UTC.
3. **T3:** `ssh $BOX 'docker stats --no-stream; free -m'`, and `curl -s -o /dev/null -w '%{http_code}\n' https://odyhook.dev`.

- [x] The nightly backup holds the `nitpilot` database, and restoring it into a scratch database works (the two count lines match).
- [x] `docker stats` after the run shows `nitpilot-server` under its 384 MiB limit, and odyhook.dev answers `200`.

## 10. Wrap up

1. **T1** and **T2:** stop both CLIs (Ctrl-C). Put NikosGkikas13 back on Claude Code: `nit-edit r '.agent = "claude-code"'`.
2. Close the four PRs, as ngkdev93-jpg (say first): for each number, `GH_TOKEN=$(gh auth token -u ngkdev93-jpg) gh pr close <n> -R $SANDBOX --delete-branch`. Their chats close on nitpilot.dev and are deleted 90 days later (`CLOSED_CHAT_RETENTION_DAYS`).
3. Keep `~/.nitpilot-hosted-r` (NikosGkikas13 stays on nitpilot.dev). For ngkdev93-jpg, either keep `~/.nitpilot-hosted-w` or sign that CLI out: in **ngkdev93-jpg's browser**, https://nitpilot.dev → avatar → **Settings** → **Devices** → **Revoke** on the device, then `rm -rf ~/.nitpilot-hosted-w`. (D5 repeats the single-player run with a fresh config anyway.)
4. Turn off nothing on the box: nitpilot.dev stays up.

## 11. Results

Run on: 2026-10-25, 11:01–18:05 UTC (with a break: the Mac slept between sections 5 and 6, and both CLIs reconnected by themselves each time), with nitpilot.dev on image `0.1.0-rc.3` (`sha256:e92412e6f7dd44dd0798ad507e59e0f343c59f66a8f70be42477bf1772ba711f`), the CLI from commit `ebf67f9`. Agents: Claude Code 2.1.277 (NikosGkikas13 in sections 3–4, ngkdev93-jpg in 6); the fake agent from source (NikosGkikas13 in 6–7). Desktop: Chrome 155.0.8059.85 on macOS 15.1. Phone: iPhone (iOS version not noted). PRs: sandbox #17 (3), #18 (4), #19 (6), #20 (7), `nitpilot-private-check` #1 (8, repo deleted after). All four sandbox PRs closed with their branches in section 10.

| Criterion (spec §20 item 4) | Section | Evidence |
|---|---|---|
| `http://nitpilot.dev` and `www.nitpilot.dev` end at `https://nitpilot.dev`, with a valid certificate | 1 | ✅ `http://nitpilot.dev` 308 → `https://nitpilot.dev/`; `https://www` 301 → apex; `http://www` 308 → `https://www` → 301 → apex; `/healthz` `{"ok":true,"version":"0.1.0"}`; `CN=nitpilot.dev`, Let's Encrypt `YE1`, until 2027-01-23 |
| Single-player reviewer: the review job starts within 5 s of "Request review", and the review is posted in the reviewer's name | 3 | ✅ #17: `review_requested` arrived 11:12:26.210, T1 `→ review` 11:12:26.569 (0.36 s); `✓ done` 11:13:06 (40 s). One review by NikosGkikas13 (COMMENTED), 4 inline comments, no `nitpilot[bot]` comment; 1 job, done at attempt 1, no duplicates; 7 webhooks processed or ignored. Claude raised 5 points (the 3 planted bugs, an SQL injection in `search.js` escalated as security, missing tests). No app badge: see below |
| Agent to agent: the chat reaches READY with exactly one `nitpilot[bot]` summary comment | 6 | ✅ #19: review 17:28:48–17:28:50 (fake, 3 points), address 17:28:50–17:29:28 (Claude, commit `22a4f86` by ngkdev93-jpg), re-review 17:29:28–17:29:31 (all resolved), `ready` at round 2; `bot_comments: 1`, `edited`, `has_log`, `has_transcript_link` all true; both commits authored by ngkdev93-jpg |
| Web Push arrives on desktop Chrome and on the iPhone Home Screen app, with no per-run callback URL | 5, 6 | ⚠️ Partly. Two subscriptions (`Chrome on macOS` 11:28, `Safari on iPhone` 11:33), no callback URL anywhere. The *Ready for your approval* push for #19 reached the **iPhone**; on the **Mac** nothing showed (Do Not Disturb off, Chrome allowed in macOS). The `notify` task ran at 17:29:32 and the server logged no push failure (failures are logged and counted; both rows kept `failCount` 0), so Google's push service took it. Not found why Chrome didn't show it; open |
| A webhook from a private repo is dropped (`PUBLIC_REPOS_ONLY`) | 8 | ✅ `pull_request.opened` from `nitpilot-private-check` stored `ignored`, note `private repo (public-only mode)`; `installation_repositories.added` processed and the repo recorded with `private` `t`; 0 chats. The repo row went away when the repo was deleted |
| `docker compose restart` in `/opt/nitpilot` mid-job loses nothing: the CLI reconnects and the job completes | 7 | ✅ #20: review started 17:36:20.855 (45 s fake); restart at 17:36:59; T1 `Disconnected (1012 server restarting)` 17:37:02, `(1006)` 17:37:03, `Connected` 17:37:06, `✓ done` 17:37:08. 1 review job, done at attempt 1, no duplicates, 3 points in the chat and the summary comment; log shows the new start at 17:37:03 |
| The nightly backup contains the `nitpilot` database, and restoring it into a scratch database works | 9 | ✅ `nitpilot-backup: ok r2:odyhook-backups/nitpilot/nitpilot-2026-10-25T18-00-58Z.sql.gz (37461 bytes)`; counts `nitpilot\|13\|2\|6\|1` = `nitpilot_restore_check\|13\|2\|6\|1`; cron line in place (no 03:30 run yet: Task 12 was the same day) |
| `docker stats` after the run shows `nitpilot-server` under its limit, and Odyhook still answers | 9 | ✅ `nitpilot-server` 179.4 MiB / 384 MiB; box 3819 MB, 2525 available, no swap; odyhook.dev `200` |
| The demo is recorded on nitpilot.dev, showing `nitpilot`, not `nitpilot-dev` | 4 | Dropped by the user's decision (2026-10-25): no demo video. The take on #18 was unusable and a retake needed a fresh single-player PR |

**What was found and fixed during the run** (each with its commit):

- **No app badge on reviews.** The runbook and spec §15 expected GitHub to show the `nitpilot` badge on a review posted with the user's token. It doesn't: no review comment on the sandbox, from Plans 1, 2 or this run, records an app (`performed_via_github_app` is null; the bot's own comments record it). Text fixed in `33ffb9e`; no code change.
- **Section 7 is agent-to-agent once ngkdev93-jpg has joined**, so the points go to the chat, not to a GitHub review; the server logs nothing when it stops (the CLI's `1012` is the evidence). Text fixed in `33ffb9e`.
- **Section 9:** the cron log file exists only after cron's first run, and `grep -c nitpilot-backup` counts the file's comment too (prints `2`). Text fixed in `33ffb9e`.
- **The address job** in section 6 started 3 s after the review, not ~30 s. Text fixed in `33ffb9e`.
- **Open: the Mac didn't show the *Ready for your approval* push** (the iPhone did). Server side looks right; not diagnosed.
- **The demo was dropped** by the user's decision (2026-10-25; see the table and section 4).
- Not a finding: the app's terminal panel refuses a command line containing a lone `r` (`nit-edit r …`), so that edit was run outside it.

## 12. D5: the CLI from npm (one Claude run)

[Spec §20](../superpowers/specs/2026-10-07-nitpilot-design.md) item 4: "D5 repeats the single-player run once with the CLI installed from npm." Done after `v0.1.0` is on npm and nitpilot.dev runs `0.1.0` (Plan 3 Task 15). ngkdev93-jpg's account on nitpilot.dev was deleted first, so ngkdev93-jpg is again someone who isn't on Nitpilot.

**T1** is a new terminal that does **not** source `hosted.sh` (its `nitpilot` function would hide the one from npm). **T3** sources it as usual.

1. **T1:** a stranger's install, in its own folder, so nothing global on this Mac changes:
   ```bash
   mkdir -p ~/nitpilot-fresh && cd ~/nitpilot-fresh
   npm install -g nitpilot --prefix ~/nitpilot-fresh/npm
   export PATH="$HOME/nitpilot-fresh/npm/bin:$PATH" NITPILOT_CONFIG_DIR="$HOME/nitpilot-fresh/config"
   command -v nitpilot && nitpilot --version
   ```
   Expect the path `~/nitpilot-fresh/npm/bin/nitpilot` and `0.1.0`.
2. **T1:** `nitpilot login`. In **NikosGkikas13's browser**, on **Approve this device?** check the code and click **Approve**. T1 prints `Logged in as NikosGkikas13.`
3. **T1:** link the clone, check, and start:
   ```bash
   nitpilot repos add ~/nitpilot-acceptance/b/nitpilot-sandbox && nitpilot doctor
   nitpilot start 2>&1 | perl ~/Desktop/PracticeProjects/nitpilot/docs/acceptance/stamp.pl
   ```
   Expect no `✗` from `doctor`, then `Connected as NikosGkikas13. Linked: NikosGkikas13/nitpilot-sandbox.`
4. Section 3's steps 1–6 once, with the branch `d5-from-npm` and the title `D5: from npm`.
5. **Wrap up:** Ctrl-C in T1; close the PR as ngkdev93-jpg (`GH_TOKEN=$(gh auth token -u ngkdev93-jpg) gh pr close $PR -R $SANDBOX --delete-branch`); `rm -rf ~/nitpilot-fresh`; revoke the device in **NikosGkikas13's browser** (https://nitpilot.dev → avatar → **Settings** → **Devices** → **Revoke**).

- [x] With `nitpilot@0.1.0` from npm: the review job started within 5 seconds of "Request review", the review is on the PR in NikosGkikas13's name, and there is no `nitpilot[bot]` comment.

**Result** (2026-10-28, 14:13–14:18 UTC; nitpilot.dev and the CLI both `0.1.0`, the CLI from `~/nitpilot-fresh/npm/bin/nitpilot`; Claude Code 2.1.277): ✅ Sandbox #21. `review_requested` arrived 14:16:39.995, T1 `→ review` 14:16:40.470 (0.48 s); `✓ done` 14:17:17 (37 s). One review by NikosGkikas13 (COMMENTED), 4 inline comments, no `nitpilot[bot]` comment; 1 job, done at attempt 1, no duplicates; 7 webhooks processed or ignored. Claude raised 4 points; the SQL injection was escalated as security, which the CLI showed as `🔔 Needs you`.

- ngkdev93-jpg's `User` row was deleted in an earlier session of this step (`DELETE 1`), which also pushed `acc/d5-from-npm`; on 2026-10-28 the table listed only NikosGkikas13, and the run reused that branch.
- In a shell where `hosted.sh` was sourced, its `nitpilot` function hides the npm one even after the `PATH` change (`command -v nitpilot` prints `nitpilot`, not a path). `unset -f nitpilot` fixes it; the steps above assume a terminal that never sourced it.
