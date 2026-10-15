# Plan 1 acceptance run (live)

The manual end-to-end test from [spec §20](../superpowers/specs/2026-10-07-nitpilot-design.md): the real server, real GitHub, two real accounts, and a real agent. Follow it top to bottom and tick the boxes. [why/live-acceptance.md](../why/live-acceptance.md) explains why this is a document and not a test.

**Time:** about 3 hours. **Cost:** account A's agent is Claude Code, so a full run uses about 6 agent runs of your Claude plan. Account B's reviewer is a scripted fake agent and costs nothing. If a run ends with a `quota` failure, wait for the plan's window to reset and carry on.

## Who is who

| | Account | Role | CLI | Agent | Config folder | Clone |
|---|---|---|---|---|---|---|
| **A** | `ngkdev93-jpg` | author | CLI A (the built bundle) | **Claude Code** | `~/.nitpilot-a` | `~/nitpilot-acceptance/a/nitpilot-sandbox` |
| **B** | `NikosGkikas13` | reviewer, owns the repo | CLI B (from source) | **fake agent** (scenario files) | `~/.nitpilot-b` | `~/nitpilot-acceptance/b/nitpilot-sandbox` |

The sandbox is `NikosGkikas13/nitpilot-sandbox`. The spec has account A owning it; here B does, and roles follow the accounts, not the ownership. The spec also has CLI B on Gemini CLI; Google refuses personal sign-ins for it ([spec §22](../superpowers/specs/2026-10-07-nitpilot-design.md)), so B's agent is the fake one. What the run proves about B is the plumbing, not a reviewer's judgment.

**Windows you will use:**
- **Window A:** a private browser window signed in to GitHub as `ngkdev93-jpg`.
- **Window B:** a normal browser window signed in as `NikosGkikas13`.
- **T1 tunnel, T2 server, T3 CLI A, T4 CLI B, T5 commands:** five terminal tabs. In each, first run `cd /path/to/nitpilot && source docs/acceptance/env.sh`.

**If something goes wrong**, stop and keep the evidence: the T2, T3 and T4 output and the output of `check.sql`. A bug found here gets a failing test first and a fix after, like any other bug; don't patch it live and carry on.

---

## 0. Before you start

- [x] Docker is running: `docker ps` lists `nitpilot-postgres-1`.
- [x] Claude Code is signed in: `claude auth status` prints `"loggedIn": true`.
- [x] The tools exist: `command -v jq perl cloudflared gh git node` prints six paths.
- [x] The dev server isn't running (stop it with Ctrl-C if it is). Nothing else uses port 8787.
- [x] The CLI is built: `npm run build -w apps/cli`, then `node apps/cli/dist/index.js --version` prints a version.

## 1. One-time setup: SSH aliases and clones (about 15 minutes)

Two SSH aliases let one laptop push as two GitHub accounts: `github-a` uses a new key that belongs to A, `github-b` uses the key you already use (B's).

1. **T5:** make a key for A (no passphrase; it only has access to a throwaway account) and copy its public half:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_nitpilot_a -N "" -C "ngkdev93-jpg nitpilot acceptance"
   pbcopy < ~/.ssh/id_ed25519_nitpilot_a.pub
   ```
2. **Window A:** open `https://github.com/settings/ssh/new`. Title: `nitpilot acceptance (laptop)`. Key type: *Authentication Key*. Click in the *Key* box, paste with ⌘V, click **Add SSH key** (GitHub may ask for A's password).
3. **T5:** add the two aliases (this creates `~/.ssh/config` if you have none; if you do, append only the two `Host` blocks):
   ```bash
   cat >> ~/.ssh/config <<'CONF'

   Host github-a
     HostName github.com
     User git
     IdentityFile ~/.ssh/id_ed25519_nitpilot_a
     IdentitiesOnly yes

   Host github-b
     HostName github.com
     User git
     IdentityFile ~/.ssh/id_ed25519
     IdentitiesOnly yes
   CONF
   chmod 600 ~/.ssh/config
   ```
4. **T5:** check both. Answer `yes` if SSH asks whether to trust the host. Exit code 1 is normal; the greeting matters:
   ```bash
   ssh -T git@github-a    # expect: Hi ngkdev93-jpg! You've successfully authenticated…
   ssh -T git@github-b    # expect: Hi NikosGkikas13! You've successfully authenticated…
   ```
   If `github-b` greets someone else or says *Permission denied*, your usual key isn't B's. Repeat steps 1 and 2 for B (key `~/.ssh/id_ed25519_nitpilot_b`, in **Window B**, at the same URL) and change `github-b`'s `IdentityFile` to it.
5. **T5:** clone the sandbox twice, once as each account:
   ```bash
   mkdir -p ~/nitpilot-acceptance/a ~/nitpilot-acceptance/b
   git clone git@github-a:NikosGkikas13/nitpilot-sandbox.git "$CLONE_A"
   git clone git@github-b:NikosGkikas13/nitpilot-sandbox.git "$CLONE_B"
   ```
6. **T5:** make A's commits A's. GitHub credits a commit to an account by the e-mail on it; the `…@users.noreply.github.com` address of account A does that without exposing a real one. Confirm A's id first (it should print `340081894`):
   ```bash
   gh api users/ngkdev93-jpg --jq .id
   git -C "$CLONE_A" config user.name ngkdev93-jpg
   git -C "$CLONE_A" config user.email 340081894+ngkdev93-jpg@users.noreply.github.com
   git -C "$CLONE_B" config user.name NikosGkikas13
   git -C "$CLONE_B" config user.email 69345580+NikosGkikas13@users.noreply.github.com
   ```
7. **T5:** push a second base branch, which section 3 retargets a PR to:
   ```bash
   git -C "$CLONE_A" push origin origin/main:refs/heads/acc/base2
   ```

- [x] Both `ssh -T` greetings are right.
- [x] Both clones exist and have the right `user.email`.

## 2. A clean database, the tunnel and the server (about 5 minutes)

A fresh database `nitpilot_acceptance` keeps your dev data untouched, and means nobody has joined Nitpilot yet, which the single-player runs need. It borrows the dev database's installation and repository rows, because GitHub only sends those once.

1. **T5:** create it, migrate it, copy the two tables:
   ```bash
   docker exec nitpilot-postgres-1 psql -U nitpilot -d postgres -c "create database $ACC_DB"
   DATABASE_URL=postgresql://nitpilot:nitpilot@localhost:5433/$ACC_DB npm run db:deploy -w apps/server
   docker exec nitpilot-postgres-1 pg_dump -U nitpilot -d nitpilot --data-only --table='"Installation"' --table='"Repo"' \
     | docker exec -i nitpilot-postgres-1 psql -U nitpilot -d $ACC_DB -q
   docker exec nitpilot-postgres-1 psql -U nitpilot -d $ACC_DB -c 'select (select count(*) from "Installation") as installations, (select count(*) from "Repo") as repos, (select count(*) from "User") as users'
   ```
   Expect `All migrations have been successfully applied.` and then `1 | 19 | 0` (installations, repos, users; the repo count is however many the app sees).
2. **T1:** start the tunnel first (webhooks reach your laptop only while it runs): `npm run dev:tunnel`. Expect `✓ nitpilot-dev now sends webhooks to https://….trycloudflare.com/webhooks/github`. Leave it running.
3. **T2:** start the server on the new database. The environment variable wins over `apps/server/.env`:
   ```bash
   DATABASE_URL=postgresql://nitpilot:nitpilot@localhost:5433/$ACC_DB npm run start -w apps/server
   ```
   Expect `Nitpilot server listening on http://localhost:8787` and a `[boot]` line. Leave it running.

- [x] Tunnel and server are up.

`dbq` (from `env.sh`) runs `psql` inside the Postgres container against this database, so you don't need `psql` installed.

## 3. The probe PR: three questions and a delivery of every kind (about 20 minutes)

No CLI runs and nobody has joined Nitpilot, so nothing reacts: the server just stores every webhook GitHub sends. You click through a PR's whole life and then read what arrived. These are the answers the spec left open (§22), and the raw material for the recorded fixtures.

1. **T5:** note the start time, then make the probe branch (it prints a link):
   ```bash
   date -u +%Y-%m-%dT%H:%M:%SZ        # write this down: PROBE_START
   cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" probe && cd "$REPO"
   ```

Now do these in order. After each, wait a couple of seconds so deliveries arrive in order.

| # | Where | Do this | GitHub should send |
|---|---|---|---|
| P1 | Window A | Open the link `new-branch.sh` printed. Title: `Acceptance probe`. Right side, **Reviewers** gear → tick `NikosGkikas13`. Click **Create pull request**. | `pull_request.opened`, `pull_request.review_requested` |
| P2 | Window B | Open the PR → **Files changed**. Hover line 5 of `orders-demo/src/orders.js`, click the blue **+**, type `probe: first comment`, click **Start a review**. Hover line 12, click **+**, type `probe: second comment`, click **Add review comment**. Click the green **Finish your review**, leave *Comment* selected, click **Submit review**. | two `pull_request_review_comment.created`, one `pull_request_review.submitted`. **Question 2:** does a `pull_request.review_request_removed` for B follow? |
| P3 | Window A | **Conversation** tab. In B's first comment thread click **Reply…**, type `probe: reply from the Conversation tab`, click the green button (*Reply* or *Add single comment*). | a `pull_request_review_comment.created` with a reply. **Question 3:** does a `pull_request_review.submitted` come too? |
| P4 | Window A | **Files changed** tab. In B's second thread click **Reply…**, type `probe: reply from Files changed`, click **Add single comment**. | the same, for this reply |
| P5 | Window A | **Conversation** tab. Right side, **Reviewers**: click the circular arrows (*Re-request review*) beside `NikosGkikas13`. | **Question 1:** is there a second `pull_request.review_requested`? |
| P6 | Window A | **Reviewers** gear → untick `NikosGkikas13`, click outside the list. Then gear → tick `NikosGkikas13` again. | `pull_request.review_request_removed`, then `review_requested` |
| P7 | Window B | **Conversation** tab. On B's first thread click **Resolve conversation**, then **Unresolve conversation**. | `pull_request_review_thread.resolved`, then `.unresolved` |
| P8 | Window B | In the box at the bottom type `probe: a plain comment`, click **Comment**. | `issue_comment.created` |
| P9 | Window A | Right side, under *Reviewers*: **Convert to draft** → confirm **Convert to draft**. Then the green **Ready for review**. | `pull_request.converted_to_draft`, then `ready_for_review` |
| P10 | T5 | Push a second commit: `cd "$CLONE_A" && git switch acc/probe && echo "probe change" >> orders-demo/README.md && git commit -am "probe: a second commit" && git push && cd "$REPO"` | `pull_request.synchronize` |
| P11 | Window A | Next to the PR title click **Edit**, change the title to `Acceptance probe (renamed)`, **Save**. Click **Edit** again, change the base branch (`base: main ▾`) to `acc/base2`, confirm, **Save**. | `pull_request.edited` (title), then `pull_request.edited` with `changes.base` (**Question 4:** a base retarget has never been seen live) |
| P12 | Window A | Scroll down, click **Close pull request**, then **Reopen pull request**, then **Close pull request** once more. | `closed`, `reopened`, `closed` |

2. **T5:** list what arrived (use the `PROBE_START` you wrote down) and read it against the table:
   ```bash
   DATABASE_URL=postgresql://nitpilot:nitpilot@localhost:5433/$ACC_DB npm run record:fixtures -w apps/server -- list --since <PROBE_START>
   ```
3. Write the answers in section 9 (Results). The questions, and how to read each from the list:

   | | Question | How to read it |
   |---|---|---|
   | Q1 | Does re-requesting a review fire `review_requested` again? | a second `pull_request.review_requested` for `NikosGkikas13` right after P5 |
   | Q2 | Does a reviewer submitting a review fire `review_request_removed`? | a `pull_request.review_request_removed` within a few seconds after P2's `pull_request_review.submitted`. **If one arrives, stop:** Nitpilot would treat it as "the reviewer left" and withdraw the agent's points right after it posts a review. That is a design change to bring to the person running this, not something to work around here |
   | Q3 | Do replies made in the GitHub page also arrive as `pull_request_review.submitted`? | a `pull_request_review.submitted` next to the reply's `pull_request_review_comment.created`, for P3 and for P4 separately |
   | Q4 | Does a base retarget arrive as `pull_request.edited` with `changes.base`? | the second `pull_request.edited` after P11 |

   (Hints from earlier deliveries in the dev database, not proof: a UI reply did arrive with a `pull_request_review.submitted`, and a review by the requested reviewer did not bring a `review_request_removed`.)

- [x] P1 to P12 done, the list read, Q1 to Q4 answered in section 9.
- [x] The probe PR is closed.

## 4. Single-player: the author (A only; B has never joined)

A is on Nitpilot, B is a person with a GitHub account only. When B comments on A's PR on GitHub, A's agent fixes it and answers in B's threads. Nothing is written as a summary comment, because only one side is on Nitpilot.

1. **T5:** A joins. Run `nit-a login --no-open` and copy the link it prints into **Window A** (without `--no-open` it opens your default browser, which is B's, and approving there connects the wrong account; codes last 10 minutes). Sign in with GitHub if asked, check the code matches the terminal, click **Approve**. Expect `Logged in as ngkdev93-jpg.`
2. **T5:** link the clone and tell CLI A which check the agent may run:
   ```bash
   nit-a repos add "$CLONE_A"
   nit-edit a '.repos[env.SANDBOX].checks = {test: ["npm", "test", "--prefix", "orders-demo"]}'
   nit-a doctor
   ```
   Expect no `✗` lines; Claude Code shows as installed and logged in.
3. **T3:** start CLI A with timestamps: `nit-a start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. Expect `Connected as ngkdev93-jpg.`
4. **T5:** `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" sp-author && cd "$REPO"`
5. **Window A:** open the link, title `Single-player: author`, Reviewers → `NikosGkikas13`, **Create pull request**. Expect nothing to start (B isn't on Nitpilot): T3 stays quiet.
6. **Window B:** open the PR → **Files changed**. Line 5 of `orders.js`: **+**, `Pages start at 1, but page 1 skips the first page. Please fix.`, **Start a review**. Line 18: **+**, `This throws for an id that does not exist. Please handle it.`, **Add review comment**. **Finish your review** → *Comment* → **Submit review**.
7. **T3:** about 30 seconds later expect `→ address of …#<PR> (attempt 1)`. (A review with no text of its own arrives looking just like GitHub's *Add single comment*, so Nitpilot waits `debounce_seconds`, 30 by default, for more comments before it acts: spec §15.) Claude works for one to four minutes. Then `✓ address of …: done`.
8. **Window B**, on the PR: a new commit `Address review feedback (round 1)`; both threads have a reply from `ngkdev93-jpg` with the app badge; no Nitpilot summary comment.
9. **T5:** `PR=<the PR number>` then `dbq -v pr=$PR -f - < docs/acceptance/check.sql`, and `gh api repos/$SANDBOX/pulls/$PR/commits | jq '[.[] | {sha: .sha[0:7], author: .author.login, trailer: (.commit.message | contains("Nitpilot-Job"))}]'`
10. **Window A:** close the PR (**Close pull request**), so later sections' catch-up and chats don't touch it.

- [x] The address job started about 30 seconds after B's review (`debounce_seconds`), and no later than a few seconds after that (T3 stamp against `check.sql` section 4).
- [x] The commit is authored by `ngkdev93-jpg` and its message has a `Nitpilot-Job` trailer.
- [x] Both of B's threads got a reply from A, as A.
- [x] No comment from `nitpilot-dev[bot]`.
- [x] `check.sql` shows no duplicate jobs, and no webhook left `received`, `retrying` or `failed`.

## 5. Single-player: the reviewer (B only; A leaves)

Now the other side. B is on Nitpilot, A is a plain GitHub user. When A asks B for a review, B's agent reviews and posts **one GitHub review** as B.

1. **T3:** stop CLI A (Ctrl-C).
2. **T5:** make A leave Nitpilot, as if they had never joined: `dbq -c "delete from \"User\" where login = 'ngkdev93-jpg'"`. Expect `DELETE 1`.
3. **T5:** B joins: `nit-b login` (use **Window B** for the link), then:
   ```bash
   nit-b repos add "$CLONE_B"
   nit-edit b '.agent = "fake"'
   nit-b doctor
   ```
   Expect `Logged in as NikosGkikas13.` and no `✗` lines.
4. **T4:** `nit-b start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. Expect `Connected as NikosGkikas13.`
5. **T5:** `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" sp-reviewer && cd "$REPO"`
6. **Window A:** open the link, title `Single-player: reviewer`, Reviewers → `NikosGkikas13`, **Create pull request**.
7. **T4:** within about 5 seconds `→ review of …#<PR> (attempt 1)`, then `✓ review of …: done`.
8. **Window B**, on the PR: one review by `NikosGkikas13` with three inline comments (lines 5, 12 and 18 of `orders.js`), showing the app badge; no summary comment.
9. **T5:** `PR=<number>`, then `gh api repos/$SANDBOX/pulls/$PR/reviews --jq length` (expect `1`), `gh api repos/$SANDBOX/pulls/$PR/comments --jq '.[].user.login'` (expect three `NikosGkikas13`), and `check.sql`.
10. **Window A:** close the PR.

- [x] The review job started within about 5 seconds of the request.
- [x] Exactly one review, with three inline comments, written as B.
- [x] No `nitpilot-dev[bot]` comment.

## 6. Agent to agent: the pass criteria

Both on Nitpilot. A's agent is Claude Code, B's is the scripted reviewer.

1. **T5:** A rejoins: `nit-a login --no-open`, link into **Window A**. Expect `Logged in as ngkdev93-jpg.` (the clone and check stay configured). **T3:** `nit-a start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. CLI B (T4) is still running.
2. **T5:** `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" happy && cd "$REPO"`
3. **Window A:** open the link, title `Agent to agent: happy path`, Reviewers → `NikosGkikas13`, **Create pull request**. Note the PR number: `PR=…`.
4. Watch. Expected, in order:
   - **T4:** `→ review of …#<PR> (attempt 1)` within 5 seconds, then `✓ review of …: done` (three points).
   - **GitHub:** one comment from `nitpilot-dev[bot]` appears a few seconds later (the summary).
   - **T3:** `→ address of …#<PR> (attempt 1)`; Claude edits `orders.js`, runs the test, replies to each point; then `✓ address of …: done` and a commit lands on the branch.
   - **T4:** `→ re-review of …`, then `✓ re-review of …: done`.
   - **T4 only:** a `🔔` line that the PR is ready. T3 prints none.
5. **T5:** check everything:
   ```bash
   dbq -v pr=$PR -f - < docs/acceptance/check.sql
   gh api repos/$SANDBOX/issues/$PR/comments | jq --arg link "/c/$SANDBOX/$PR" '[.[] | select(.user.login == "nitpilot-dev[bot]")] | {bot_comments: length, edited: (.[0].updated_at != .[0].created_at), has_log: (.[0].body | contains("<summary>Review log")), has_transcript_link: (.[0].body | contains($link))}'
   gh api repos/$SANDBOX/pulls/$PR/comments --jq length
   gh api repos/$SANDBOX/pulls/$PR/commits | jq '[.[] | select(.commit.message | contains("Nitpilot-Job")) | {sha: .sha[0:7], author: .author.login, email: .commit.author.email}]'
   ```
6. Open the transcript link from the summary comment (in **Window B**, sign in with GitHub if the page asks). It shows the whole conversation and the chat as ready.

**Pass criteria** (spec §20):
- [x] B's review job starts within 5 seconds of the review request (T4's `→ review of …` stamp minus the first row of `check.sql` section 4).
- [x] The chat reaches `ready` within `max_rounds` (3): `check.sql` section 1 shows `ready` and a round of 3 or less.
- [x] Exactly one `nitpilot-dev[bot]` comment (`bot_comments: 1`), edited across rounds (`edited: true`), with the collapsed log and the transcript link (`has_log` and `has_transcript_link` true).
- [x] No agent comments in the PR's review threads (the `pulls/$PR/comments` count is `0`).
- [x] The fix commits are authored by A (`author: "ngkdev93-jpg"` on every commit with a trailer).
- [x] Only B is notified: T4 shows one `🔔` line saying the PR is ready, T3 shows none. (T2 shows no `[notify]` line either: the server only logs a notification for someone whose CLI is offline.)
- [x] No job is duplicated (`check.sql` section 3 prints no rows), and every `RawEvent` is processed (section 5 shows only `processed` and `ignored`).

## 7. Variants

Close each variant's PR when you're done with it, so it can't affect the next.

### 7.1 A security point escalates

1. **T4:** stop CLI B (Ctrl-C), then restart it on the security scenario:
   ```bash
   export B_SCENARIO="$REPO/docs/acceptance/scenarios/sandbox-security.json"
   nit-b start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
2. **T5:** `cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" security && cd "$REPO"`. **Window A:** open the link, title `Variant: security`, Reviewers → `NikosGkikas13`, **Create pull request**. `PR=…`
3. Expect: **T4** `→ review of …`, `✓ review of …: done` (one point); a `🔔` line about an escalation in **both** T3 and T4 (each person is notified once); T3 never prints `→ address of …`.
4. **T5:** `check.sql`.

- [x] Section 1 shows the chat as `escalated`; section 6 shows P1 as `escalated` with reason `category`.
- [x] Both people were notified (one `🔔` line each in T3 and T4), and no address job ran.

Then **T4:** stop CLI B, `unset B_SCENARIO`, start it again as in section 5, step 4.

### 7.2 Stopping B's CLI shows "offline since…", and the job completes after a restart

1. **T4:** stop CLI B (Ctrl-C). Wait a few seconds.
2. **T5:** new branch `offline`; **Window A:** open the PR, title `Variant: offline`, Reviewers → `NikosGkikas13`. `PR=…`
3. Nothing runs. Open `http://localhost:8787/c/NikosGkikas13/nitpilot-sandbox/$PR` in **Window B** (sign in with GitHub if asked). It says `NikosGkikas13's agent is waiting: offline since …` with about the time you stopped CLI B.
4. Wait a full minute, then **T4:** `nit-b start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. Within about 5 seconds `→ review of …#<PR> (attempt 1)`. The run carries on to ready, with A's agent fixing as in section 6.

- [x] The page showed "offline since …" while B was stopped.
- [x] The review ran once, after the restart (`check.sql` section 3 prints no rows), and the chat reached `ready`.

### 7.3 A manual push during an address job triggers `branch_moved` and a new plan

1. **T5:** new branch `push-mid`; **Window A:** open the PR, title `Variant: manual push`, Reviewers → `NikosGkikas13`. `PR=…`
2. Watch **T3**. The moment it prints `→ address of …#<PR> (attempt 1)`, go to **T5** and push as a human, quickly:
   ```bash
   cd "$CLONE_A" && git switch acc/push-mid && echo "a human edit" >> orders-demo/README.md && git commit -am "human: tweak the README" && git push; cd "$REPO"
   ```
3. Expect: the chat timeline says `New commits pushed (…)`; **T3** prints `■ Stopped …: branch moved.` (or, if Claude pushed second and lost the race, git rejects its push and the job fails as `branch_moved`); then a new `→ address of …` on the new head; the PR reaches ready.
4. If Claude had already pushed before you, your push was an ordinary one and nothing was cancelled. That isn't a failure of Nitpilot: repeat on a new PR and push faster.
5. **T5:** `check.sql`.

- [x] An address job shows `cancelled` with `branch_moved` (section 2), followed by a later address job on the new head, and the timeline has the "New commits pushed" line.
- [x] Nothing was force-pushed: the branch's history on GitHub keeps your commit.

### 7.4 Closing the PR mid-job cancels and cleans up

1. **T5:** new branch `close-mid`; **Window A:** open the PR, title `Variant: close mid-job`, Reviewers → `NikosGkikas13`. `PR=…`
2. When **T3** prints `→ address of …#<PR> (attempt 1)`, go to **Window A** and click **Close pull request**.
3. Expect **T3** `■ Stopped …: pr closed.` within seconds, and no `✓`.
4. **T5:** check nothing is left behind:
   ```bash
   ls ~/.nitpilot-a/worktrees/NikosGkikas13/nitpilot-sandbox/ 2>&1     # empty, or "No such file"
   pgrep -fl 'claude -p' || echo "no claude running"
   dbq -v pr=$PR -f - < docs/acceptance/check.sql
   ```

- [x] The address job is `cancelled` with `pr_closed`, the chat is `closed`, the worktree folder is gone, and no agent process is left.

## 8. Wrap up

1. Record the deliveries this run produced as fixtures (Task 24, Step 22). Do it before the database goes away.
2. Stop T1 to T4 (Ctrl-C).
3. Fill in section 9. Keep this file as the record of the run.
4. Optional: `docker exec nitpilot-postgres-1 psql -U nitpilot -d postgres -c "drop database $ACC_DB"` once the fixtures are saved. Your dev database was never touched.

## 9. Results

Run on: 2026-10-14 (sections 0 to 3) and 2026-10-15 (sections 4 to 7), with Nitpilot at commit `b771749`, plus the fix `c67e15a` from section 4 on. Agent A: Claude Code 2.1.277 through the built CLI; agent B: the fake agent from source.

**Answers to the spec's open questions** (section 3):

| | Answer |
|---|---|
| Q1: re-request fires `review_requested` again? | **Yes.** P5 (Re-request review) sent a second `pull_request.review_requested` for NikosGkikas13 (14:23:01Z), after B had reviewed. |
| Q2: a submitted review fires `review_request_removed`? | **No.** Nothing followed P2's `pull_request_review.submitted` (14:18:58Z) in the next 5 minutes; the only removal came from unticking the reviewer (P6). |
| Q3: UI replies also arrive as `pull_request_review.submitted`? | **Yes, from both tabs.** The Conversation-tab reply (P3) and the Files-changed *Add single comment* reply (P4) each came as a `pull_request_review.submitted` (`commented`) plus a `pull_request_review_comment.created`, in the same second. |
| Q4: a base retarget arrives as `edited` with `changes.base`? | **Yes.** The second `pull_request.edited` (14:30:40Z) has `changes.base.ref.from: "main"` and `changes.base.sha.from`, and `pull_request.base.ref` is `acc/base2`; it normalizes to `pr_retargeted`. |

**What was found and fixed during the run** (each with its commit):

- **Our agent's own thread replies came back as human messages** (section 4, PR 4). GitHub wraps each reply the agent posts in a `pull_request_review.submitted` with no body; the router only checked a review's own body and id, so the reply reached the chat twice (once as the agent's reply, once as a "human" line). Fixed in `c67e15a` (a review that holds only our own comments is our own write), with a failing test first; sections 6 and 7 ran on the fix and showed no duplicates.
- **The runbook expected the address job within 5 seconds of B's review** (section 4). B's review had no text of its own, which Nitpilot rightly treats like *Add single comment* and waits `debounce_seconds` (30 s) for (spec §15). Section 4's step 7 and its first box now say so; no code change.
- **`check.sql` section 3 counted a cancelled job and its replacement as a duplicate** (7.3, which makes exactly that on purpose). It now leaves cancelled jobs out.

**Ticks:** every box in sections 1 to 7 above is ticked, or has a note here saying why not:

- All 32 boxes are ticked.
- Differences from the clicks written above: after the probe's P10, the remaining GitHub actions were done with `gh` instead of the browser. PRs were opened, closed and asked for review as `ngkdev93-jpg` with a second `gh` account (`gh auth login`, then `GH_TOKEN=$(gh auth token --user ngkdev93-jpg)`); P11 and P12 (title edit, base retarget, close and reopen) were done as the repo owner `NikosGkikas13`; B's review in section 4 was posted with `gh api …/pulls/<n>/reviews` (event `COMMENT`, two inline comments, no body); the pushes in 7.3 and the close in 7.4 were scripted to fire the moment the address job showed `running` in the database. The person approved each `nitpilot login` in the browser.
- `nit-a login` opens your default browser; when that is B's, the approve page there approves the wrong account. Paste the link into A's window, or block the automatic open (we put a no-op `open` first on `PATH`). `nitpilot login --no-open` was added after the run for this; sections 4 and 6 now use it.
- In 7.1 GitHub failed the reviewer request that `gh pr create` makes after creating the PR (a GraphQL error on GitHub's side); the review was requested again through the REST API and the run went on.
- In 7.2 B's re-review needed a second attempt: it was handed out the moment A's push was announced, before GitHub had moved the PR's ref, so B's CLI fetched the old head and answered `stale_head`; the engine re-ran it at once without counting the attempt, and it passed 2.5 s later.
- Timings: B's review job started 0.35 to 0.7 s after the review request (sections 5 and 6); Claude Code's address passes took 41 to 64 s.
