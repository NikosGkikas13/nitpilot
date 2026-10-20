# Plan 2 acceptance run (live)

The manual end-to-end test of the web app, from [spec §20](../superpowers/specs/2026-10-07-nitpilot-design.md) ("Plan 2 acceptance test"): the real server serving the built web app, real GitHub, two real accounts in two browsers and on a phone, and a real agent. Follow it top to bottom and tick the boxes. [why/live-acceptance.md](../why/live-acceptance.md) explains why this is a document and not a test.

**Time:** about 2½ hours. **Cost:** ngkdev93-jpg's agent is Claude Code, so a full run uses about 4 agent runs of your Claude plan (one each in sections 4, 5 and 6, and maybe one more if a round needs it). NikosGkikas13's reviewer is the scripted fake agent and costs nothing. If a run ends with a `quota` failure, wait for the plan's window to reset and carry on.

## Who is who

| Account | Role | CLI | Agent | Where you click |
|---|---|---|---|---|
| `ngkdev93-jpg` | author | the built bundle (`nit-a`) | **Claude Code** | **ngkdev93-jpg's browser**: a Chrome private window (⇧⌘N) signed in to GitHub as `ngkdev93-jpg` |
| `NikosGkikas13` | reviewer, owns the sandbox repo | from source (`nit-b`) | **fake agent** (scenario files) | **NikosGkikas13's browser**: your normal Chrome window, signed in to GitHub as `NikosGkikas13`; and **NikosGkikas13's iPhone** |

The sandbox is `NikosGkikas13/nitpilot-sandbox`, as in [plan-1.md](plan-1.md). Push is turned on for NikosGkikas13 only, in the normal Chrome window and on the iPhone: a private window can't receive push, and ngkdev93-jpg doesn't need it (that account's notifications come through its CLI, as in Plan 1).

**The address everyone uses.** The tunnel's `https://….trycloudflare.com` address is the server's `PUBLIC_URL` for the whole run, in both browsers and on the phone. The session cookie and the web app's Origin check both follow `PUBLIC_URL`, so a browser on `http://localhost:8787` would be refused its writes. The CLIs still talk to `http://localhost:8787` directly (`env.sh`); they send no cookie and no Origin. The address changes every time the tunnel starts, so the GitHub App gets its sign-in callback for this address in section 1 and loses it in section 8.

**Terminals:** **T1** tunnel, **T2** server, **T3** ngkdev93-jpg's CLI, **T4** NikosGkikas13's CLI, **T5** commands. In each, first run `cd /path/to/nitpilot && source docs/acceptance/env.sh`.

**If something goes wrong**, stop and keep the evidence: a screenshot of the page, the T2, T3 and T4 output, and the output of `check.sql` and `check-web.sql`. A bug found here gets a failing test first and a fix after, like any other bug; don't patch it live and carry on.

**Ask before:** starting the tunnel and the server; every step that writes to GitHub (each PR, the callback URL, the private repo in 7.2); each Claude Code run; turning push on (it registers the browser with Google's and Apple's push services).

---

## 0. Before you start

- [x] Docker is running: `docker ps` lists `nitpilot-postgres-1`.
- [x] Claude Code is signed in: `claude auth status` prints `"loggedIn": true`.
- [x] The tools exist: `command -v jq perl cloudflared gh git node` prints six paths.
- [x] Nothing uses port 8787 (stop the dev server with Ctrl-C if it runs).
- [x] Private repos aren't filtered out: `grep '^PUBLIC_REPOS_ONLY=' apps/server/.env` prints `false` (section 7.2 needs a private repo).
- [x] The web app and the CLI are built: `npm run build && npm run build -w apps/cli` (the first builds the web app only), then `node apps/cli/dist/index.js --version` prints a version and `ls apps/web/dist/index.html` finds the page.
- [x] Plan 1's one-time setup is still there: `ssh -T git@github-a` greets `ngkdev93-jpg`, `ssh -T git@github-b` greets `NikosGkikas13`, and both clones exist (`ls "$CLONE_A" "$CLONE_B"`). If not, do [plan-1.md](plan-1.md) section 1 first.
- [x] Push keys: `grep -c '^VAPID_PUBLIC_KEY=.' apps/server/.env` prints `1`. If it prints `0`, run `npm run -s vapid:keys -w apps/server >> apps/server/.env` (the keys go straight into the file, never onto the screen), then open `apps/server/.env` in your editor and change the last line's `mailto:you@example.com` to a contact address of yours (the push services may write to it).
- [x] macOS lets Chrome show notifications: System Settings → **Notifications** → **Google Chrome** → *Allow notifications* is on.
- [x] The iPhone runs iOS 16.4 or later (Settings → General → About → iOS Version). Web Push on iPhone only works from a Home Screen app.

## 1. A clean database, the tunnel, the server and the callback URL (about 10 minutes)

A fresh database `nitpilot_acceptance` keeps your dev data untouched, and means nobody has joined Nitpilot yet, so both people go through the web app's setup. It borrows the dev database's installation and repository rows, because GitHub only sends those once.

1. **T5:** create it, migrate it, copy the two tables:
   ```bash
   docker exec nitpilot-postgres-1 psql -U nitpilot -d postgres -c "create database $ACC_DB"
   DATABASE_URL=postgresql://nitpilot:nitpilot@localhost:5433/$ACC_DB npm run db:deploy -w apps/server
   docker exec nitpilot-postgres-1 pg_dump -U nitpilot -d nitpilot --data-only --table='"Installation"' --table='"Repo"' \
     | docker exec -i nitpilot-postgres-1 psql -U nitpilot -d $ACC_DB -q
   dbq -c 'select (select count(*) from "Installation") as installations, (select count(*) from "Repo") as repos, (select count(*) from "User") as users'
   ```
   Expect `All migrations have been successfully applied.` and then `1 | <n> | 0` (one installation, however many repos the app sees, no users).
2. **T1:** start the tunnel (webhooks reach your laptop only while it runs): `npm run dev:tunnel`. Expect `✓ nitpilot-dev now sends webhooks to https://<words>.trycloudflare.com/webhooks/github`. Leave it running.
3. **T2** and **T5:** remember the address, without `/webhooks/github` (paste yours):
   ```bash
   export TUNNEL=https://<words>.trycloudflare.com
   ```
4. **T2:** start the server on the new database, with the tunnel as its address. The environment wins over `apps/server/.env`:
   ```bash
   DATABASE_URL=postgresql://nitpilot:nitpilot@localhost:5433/$ACC_DB PUBLIC_URL=$TUNNEL npm run start -w apps/server
   ```
   Expect `Nitpilot server listening on http://localhost:8787` and a `[boot]` line. It serves the built web app from `apps/web/dist`. Leave it running.
5. **T5:** `curl -s $TUNNEL/healthz` prints `{"ok":true,"version":…}` (the tunnel reaches the server), and `curl -sI $TUNNEL/ | grep -i content-security` shows the `frame-ancestors 'none'` header.
6. **NikosGkikas13's browser** (this account owns the GitHub App): give the app its sign-in callback for this address.
   1. Open `https://github.com/settings/apps/nitpilot-dev`. GitHub may ask for your password or a passkey first ("Confirm access").
   2. Scroll down to the section **Identifying and authorizing users**. GitHub calls the callback a **Redirect URI** (it said *Callback URL* before 2026): there are one or more boxes with the addresses you use for development (leave them as they are).
   3. Click the grey **Add Redirect URI** button under them (or use a box that is empty). A new empty box appears. Leave *Allow wildcard matching* off.
   4. Click into the new box and type your address followed by `/auth/github/callback`, for example `https://<words>.trycloudflare.com/auth/github/callback` (in **T5**, `echo $TUNNEL/auth/github/callback` prints it to copy).
   5. Scroll to the very bottom of the page and click the green **Save changes** button. A blue banner at the top says the app was updated.

- [x] The database has `1 | <n> | 0`; the tunnel and the server are up; `healthz` answers through the tunnel.
- [x] The tunnel's callback URL is saved on `nitpilot-dev`.

`dbq` (from `env.sh`) runs `psql` inside the Postgres container against this database, so you don't need `psql` installed.

## 2. Both people join through the web app (about 15 minutes)

Nobody is on Nitpilot yet. Each person signs in to the web app, approves their computer on the web app's approve page, and starts their CLI. NikosGkikas13's checklist should tick itself off step by step, without a reload.

1. **NikosGkikas13's browser:** open a new tab, paste the `$TUNNEL` address, with its `https://`, and press Enter. You see the landing page: the heading *Your agents review each other's PRs the moment they open.* and a **Sign in with GitHub** button. Click it.
2. GitHub shows *Authorize nitpilot-dev* the first time (a green **Authorize nitpilot-dev** button at the bottom): click it. If you authorized it before, GitHub sends you straight back.
3. You land on **Set up Nitpilot**, a checklist of five rows with "… of 5" at the top. Row 1 is ticked: *Signed in as @NikosGkikas13.* Row 2, *Install the GitHub App on your repos*, is ticked too (this account owns the installation). Row 3, *Connect your computer*, is the active one: a command block with a **Copy** button and *Waiting for your terminal…*. Leave this tab open.
4. **T5:** connect NikosGkikas13's computer:
   ```bash
   nit-b login --no-open
   ```
   It prints a link and a code like `ABCD-EFGH`. Copy the link.
5. **NikosGkikas13's browser:** open a second tab, paste the link, press Enter. The page says **Approve this device?** and shows the code in big letters: check it is the same as in T5. Below it is your computer's name and *requested HH:MM*. Click the blue **Approve** button. The page changes to **Device approved**.
6. **T5:** expect `Logged in as NikosGkikas13.` Then go back to the **Set up Nitpilot** tab (don't reload it): row 3 is ticked and says *Connected: <your computer's name>*.
7. **T5:** check the CLI: `nit-b doctor`. Expect no `✗` lines (the agent is `fake`, from Plan 1's config).
8. **T4:** start NikosGkikas13's CLI with timestamps, on the happy scenario:
   ```bash
   unset B_SCENARIO
   nit-b start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
   Expect `Connected as NikosGkikas13.` Back on the **Set up Nitpilot** tab, without a reload, rows 4 (*Link a repo*) and 5 (*Start your agent*) tick, the top says *5 of 5*, and the *Skip for now* link at the bottom is replaced by **Open your inbox**. Click it: the inbox, with the tabs *To review* and *Mine*, and nothing in them yet.
9. **ngkdev93-jpg's browser** (the private window): paste the `$TUNNEL` address, press Enter, click **Sign in with GitHub**. If GitHub asks you to sign in, sign in as `ngkdev93-jpg`; click **Authorize nitpilot-dev** if it asks. You land on **Set up Nitpilot** with row 1 *Signed in as @ngkdev93-jpg.* Row 2 may or may not be ticked (this account doesn't own the installation; GitHub may still list it because the account is a collaborator on the sandbox). Either is fine: don't install anything.
10. **T5:** connect ngkdev93-jpg's computer: `nit-a login --no-open`. Copy the link it prints into a **new tab of ngkdev93-jpg's browser** (not NikosGkikas13's: approving there would connect the wrong account). Check the code, click **Approve**, see **Device approved**. T5: `Logged in as ngkdev93-jpg.`
11. **T5:** `nit-a doctor`. Expect no `✗` lines; Claude Code shows as installed and logged in.
12. **T3:** start ngkdev93-jpg's CLI: `nit-a start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`. Expect `Connected as ngkdev93-jpg.` In ngkdev93-jpg's browser, the checklist ticks rows 3 to 5 the same way; click **Open your inbox** (or **Skip for now**, if row 2 stayed open).

- [x] Both people signed in to the web app and approved their computer on its approve page.
- [x] NikosGkikas13's checklist went from row 3 to *5 of 5* without a reload.
- [x] Both CLIs say `Connected as …`.

## 3. Push on desktop Chrome and on the iPhone (about 15 minutes)

Ask first: turning push on registers each browser with its push service (Google's for Chrome, Apple's for the iPhone), and every notification of the run goes through them.

1. **NikosGkikas13's browser**, in the inbox: click your avatar, top left beside the Nitpilot wordmark (its label is *Settings · NikosGkikas13*). The **Settings** page opens, with a menu on the left: Devices, Agent, Notifications, Defaults, Account.
2. In the **Notifications** card, click the **Push notifications** switch (it's off: grey). Chrome shows a small box under the address bar: *<words>.trycloudflare.com wants to Show notifications*. Click **Allow**. The switch turns blue (on).
3. **NikosGkikas13's iPhone:** open **Safari**, type the `$TUNNEL` address in the address bar **with `https://` in front** (AirDrop it or type it), and go. Safari doesn't upgrade a typed address to https, and the tunnel answers plain http too: the sign-in cookie is `Secure`, so over http it is dropped and GitHub's sign-in ends in *This sign-in link expired or was changed* (seen in the 2026-10-20 run). Tap **Sign in with GitHub** and sign in as `NikosGkikas13` (GitHub on the phone may ask for your password and a two-factor code). You land in the inbox (the account is set up already).
4. Tap the **Share** button (the square with an arrow pointing up, in the bar at the bottom). Scroll the sheet down and tap **Add to Home Screen**. The name says *Nitpilot*; tap **Add** (top right).
5. Go to the Home Screen (swipe up from the bottom) and tap the new **Nitpilot** icon. The app opens full screen, without Safari's address bar. If it shows the landing page, tap **Sign in with GitHub** again inside it (a Home Screen app keeps its own cookies).
6. Tap your avatar (top left) → **Settings** → in **Notifications**, tap the **Push notifications** switch. iOS asks *"Nitpilot" Would Like to Send You Notifications*: tap **Allow**. The switch turns on.
7. **T5:** `dbq -v pr=0 -f - < docs/acceptance/check-web.sql`. Section 4 lists two rows for `NikosGkikas13`, one per browser.

- [x] Push is on in NikosGkikas13's Chrome window and in the iPhone's Home Screen app: two subscriptions in `check-web.sql` section 4.

## 4. Live updates, a note, a failed job and Retry, and push (the first PR; one Claude run)

This PR covers four criteria. NikosGkikas13's agent fails its review on purpose (the `crash` scenario), so the chat shows Retry. While it's failed, ngkdev93-jpg writes a note to the agents. Then NikosGkikas13's CLI comes back on the happy scenario, Retry runs the review again, Claude Code fixes the three points (and follows the note), and the chat ends ready, which notifies NikosGkikas13 by push.

1. **T4:** stop NikosGkikas13's CLI (Ctrl-C), then start it on the crash scenario:
   ```bash
   export B_SCENARIO="$REPO/apps/cli/src/agents/fake/scenarios/crash.json"
   nit-b start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
2. **T5:** make the branch, then open the PR as ngkdev93-jpg with NikosGkikas13 as reviewer (ask first: this writes to GitHub):
   ```bash
   cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" live && cd "$REPO"
   GH_TOKEN=$(gh auth token --user ngkdev93-jpg) gh pr create --repo $SANDBOX --head acc/live --base main \
     --title "Plan 2: live updates and Retry" --body "Plan 2 acceptance run." --reviewer NikosGkikas13
   ```
   It prints the PR's address; note the number: `PR=…`. (If `gh` says the reviewer request failed, GitHub made the PR anyway: request the review with `GH_TOKEN=$(gh auth token --user ngkdev93-jpg) gh api -X POST repos/$SANDBOX/pulls/$PR/requested_reviewers -f 'reviewers[]=NikosGkikas13'`.)
3. **Both browsers**, in the inbox (don't reload from here on): the PR appears by itself, in NikosGkikas13's **To review** tab and in ngkdev93-jpg's **Mine** tab (click **Mine** at the top of the list). Click the row in each browser to open the chat. The URL ends `/c/NikosGkikas13/nitpilot-sandbox/<PR>`.
4. Watch **T4** and **NikosGkikas13's browser**: T4 prints `→ review of …#<PR> (attempt 1)` and a failure, three times (the server tries a crashed job 3 times). The chat then shows an amber banner under the header: **Your agent couldn't finish** / *The timeline says why.*, with a **Retry** button. In NikosGkikas13's inbox the row's pill changes too.
5. **ngkdev93-jpg's browser**, in the chat: click the box at the bottom (*Message the agents…*) and type this note exactly, then press Enter (↵):
   ```
   Please also add the line // checked in the Plan 2 acceptance run as the first line of orders-demo/src/orders.js.
   ```
   The note appears at the end of the timeline under your name, and the box empties. It also appears in NikosGkikas13's browser, live.
6. **T4:** stop the CLI (Ctrl-C) and start it on the happy scenario:
   ```bash
   export B_SCENARIO="$REPO/docs/acceptance/scenarios/sandbox-happy.json"
   nit-b start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
7. **NikosGkikas13's browser:** click **Retry** in the banner. It says *Retrying…* for a moment; the banner goes. Then watch both browsers, without reloading (ask first: the next step starts Claude Code):
   - Under the timeline, a progress line with a pulsing dot: *NikosGkikas13's agent is reviewing…* (in NikosGkikas13's own browser: *Your agent is reviewing…*), with what it's doing beside it.
   - Three point cards appear (P1 to P3, on lines 5, 12 and 18 of `orders.js`), and the progress line goes.
   - **T3:** `→ address of …#<PR> (attempt 1)`. Both chats now show *ngkdev93-jpg's agent is …* (or *Your agent is …* in ngkdev93-jpg's own browser), its words changing as Claude works (getting the code, running, pushing). The inbox rows' pills change with it, in both browsers.
   - Claude's replies appear on each point; a commit lands; then *NikosGkikas13's agent is re-reviewing…*, the points turn resolved, and NikosGkikas13's chat shows the green **Ready for your approval** banner.
8. **Push**, the moment the chat is ready:
   - **NikosGkikas13's Mac:** a notification from **Google Chrome** (top right of the screen) titled *Ready for your approval*, showing the trycloudflare address. Click it: Chrome comes to the front on the chat.
   - **NikosGkikas13's iPhone:** the same notification on the lock screen or as a banner, from **Nitpilot**. Tap it: the Home Screen app opens on the chat.
   - **T4** prints a `🔔 Ready for your approval …` line, and **no** second notification appears on the Mac from **Script Editor** titled *Nitpilot* (that is what the CLI shows when push didn't reach you).
9. **T5:** check it all:
   ```bash
   dbq -v pr=$PR -f - < docs/acceptance/check.sql
   dbq -v pr=$PR -f - < docs/acceptance/check-web.sql
   gh api "repos/$SANDBOX/contents/orders-demo/src/orders.js?ref=acc/live" --jq .content | base64 -d | head -2
   gh api repos/$SANDBOX/pulls/$PR/commits | jq '[.[] | {sha: .sha[0:7], author: .author.login}]'
   ```
10. **T5:** close the PR so later sections don't touch it: `gh pr close $PR --repo $SANDBOX`.

- [x] **Live (spec §20):** the inbox rows and the open chat changed while the agents worked, including the progress line, in both browsers, without a reload.
- [x] **A note reaches the agents' next job:** `orders.js` starts with `// checked in the Plan 2 acceptance run`, and `check-web.sql` section 3 shows the note written before the `address for ngkdev93-jpg` job (in this section the next job is NikosGkikas13's retried review, then the address job).
- [x] **A failed job shows Retry, and Retry runs it again:** `check.sql` section 2 shows NikosGkikas13's first review `failed` (`crash`, attempt 3) and a second review `done`; the timeline says *NikosGkikas13 asked their agent to try again*; the **Retry** banner showed only in NikosGkikas13's browser.
- [x] **Web Push** arrived on desktop Chrome and on the iPhone (from the Home Screen app), and clicking each opened the chat.
- [x] **With push on, the CLI showed no OS notification:** T4 has the `🔔` line, and no *Script Editor* notification appeared.

## 5. Drafts with Auto off (the second PR; one Claude run)

With Auto off, an agent's work waits as a draft for its person to read and send. NikosGkikas13 turns Auto-review off and ngkdev93-jpg turns Auto-fix off before the PR opens, so the new chat starts with both off.

1. **NikosGkikas13's browser:** avatar → **Settings** → in **Defaults for new chats**, click the **Auto-review** switch so it turns grey (off). **ngkdev93-jpg's browser:** avatar → **Settings** → **Defaults for new chats** → click **Auto-fix** (not Auto-review: ngkdev93-jpg is the author) so it turns grey. Each switch saves at once. **T5:** `dbq -c 'select login, "autoReview", "autoAddress" from "User"'` shows NikosGkikas13 `f | t` and ngkdev93-jpg `… | f`.
2. **T5:** new branch and PR (ask first: writes to GitHub):
   ```bash
   cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" drafts && cd "$REPO"
   GH_TOKEN=$(gh auth token --user ngkdev93-jpg) gh pr create --repo $SANDBOX --head acc/drafts --base main \
     --title "Plan 2: drafts" --body "Plan 2 acceptance run." --reviewer NikosGkikas13
   ```
   `PR=…`. Open the chat in both browsers from the inbox. In each chat's header, your own switch reads off (*Auto-review* for NikosGkikas13, *Auto-fix* for ngkdev93-jpg).
3. **T4:** `→ review of …` and `✓ review of …: done`. **NikosGkikas13's browser:** a draft card appears in the timeline, *Draft: Your agent wants to raise 3 points*, with **Send** and **Discard** buttons. Nothing is on GitHub: in **T5**, `gh api repos/$SANDBOX/pulls/$PR/comments --jq length` prints `0`.
4. **NikosGkikas13's browser:** click **Send** on the card. The card goes and the three point cards appear in the chat. GitHub gets no review: both people are on Nitpilot, so the points live in the chat (only a reviewer whose author isn't on Nitpilot answers on GitHub, spec §6.1), and the same command still prints `0`. (Ask first: the next step starts Claude Code.)
5. **T3:** `→ address of …`, then `✓ address of …: done`. The fix commit stays on ngkdev93-jpg's laptop. **ngkdev93-jpg's browser:** a draft card *Draft: Your agent wants to push fixes for P1, P2 and P3* (or a mix of fixes and replies) with the words *Not pushed*, a list of the changed files, and the diff of `orders-demo/src/orders.js` open under it (green `+` and red `−` lines). Check GitHub still has the old head and the commit is only local:
   ```bash
   gh api repos/$SANDBOX/pulls/$PR --jq .head.sha
   git -C "$CLONE_A" for-each-ref refs/nitpilot/drafts
   ```
   The first prints the same commit as before the job (the seed's); the second lists one draft ref.
6. **ngkdev93-jpg's browser:** click **Send** on that card. The banner says *Sending your agent's fixes.* and the timeline *ngkdev93-jpg is sending the drafted fixes*; T3 prints a publish job; then the timeline says *ngkdev93-jpg's agent pushed <sha>* and the card goes.
7. **T4:** `→ re-review of …`, `✓ … done`. **NikosGkikas13's browser:** a second draft card, *Draft: Your agent wants to settle P1, P2 and P3*. Click **Send**. The points turn resolved and the chat shows **Ready for your approval**.
8. **T5:**
   ```bash
   dbq -v pr=$PR -f - < docs/acceptance/check-web.sql
   gh api repos/$SANDBOX/pulls/$PR/commits | jq '[.[] | select(.commit.message | contains("Nitpilot-Job")) | {sha: .sha[0:7], author: .author.login, email: .commit.author.email}]'
   git -C "$CLONE_A" for-each-ref refs/nitpilot/drafts
   gh pr close $PR --repo $SANDBOX
   ```
9. Turn the defaults back on: **Auto-review** in NikosGkikas13's Settings, **Auto-fix** in ngkdev93-jpg's (both switches blue again).

- [x] **A reviewer draft waited for Send**, and Send put its three points into the chat (and none on GitHub, both before and after).
- [x] **An author draft, with its diff, waited for Send**, while GitHub's head stayed on the old commit; Send pushed it.
- [x] **The pushed commit is authored by ngkdev93-jpg** (`author: "ngkdev93-jpg"`), and the draft ref is gone from the clone afterwards.
- [x] `check-web.sql` section 1 shows both people with `auto` false, and section 2 shows the drafted jobs `applied` (a `publish` job among them).

## 6. A security point escalates: Continue, then Resolve (the third PR; one Claude run)

NikosGkikas13's agent follows `sandbox-escalation.json`: it raises a security point, which goes to the people. ngkdev93-jpg lets the agents continue; Claude fixes it; the re-review settles it and raises a second security point; NikosGkikas13, who raised it, resolves it, and the chat is ready.

1. **T4:** stop the CLI (Ctrl-C), start it on the escalation scenario:
   ```bash
   export B_SCENARIO="$REPO/docs/acceptance/scenarios/sandbox-escalation.json"
   nit-b start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"
   ```
2. **T5:** new branch `escalation`, and the PR (ask first: writes to GitHub):
   ```bash
   cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" escalation && cd "$REPO"
   GH_TOKEN=$(gh auth token --user ngkdev93-jpg) gh pr create --repo $SANDBOX --head acc/escalation --base main \
     --title "Plan 2: escalation" --body "Plan 2 acceptance run." --reviewer NikosGkikas13
   ```
   `PR=…`. Open the chat in both browsers.
3. Both chats show a red banner, **Needs a human decision**, about P1 (*The customer name goes straight into the SQL*). In **ngkdev93-jpg's browser** it has a **Continue** button and no **Resolve** (only the reviewer who raised a point may resolve it). In **NikosGkikas13's browser** it has both. NikosGkikas13 also gets a push (desktop and iPhone); ngkdev93-jpg gets the notice in T3 (`🔔`) and as a desktop notification from the CLI.
4. **ngkdev93-jpg's browser:** click **Continue** (ask first: this starts Claude Code). A message says *Agents will keep going on P1.* and the timeline *ngkdev93-jpg let the agents continue on P1*. T3: `→ address of …`; Claude fixes the SQL; T4: `→ re-review of …`.
5. Both chats: P1 turns resolved, and a new point P2 (*Anyone who can call this reads any customer's orders*) escalates: the red banner is back, about P2.
6. **NikosGkikas13's browser:** click **Resolve** in the banner. A message says *P2 resolved.*; the banner turns green: **Ready for your approval**.
7. **T5:**
   ```bash
   dbq -v pr=$PR -f - < docs/acceptance/check.sql
   dbq -v pr=$PR -f - < docs/acceptance/check-web.sql
   gh pr close $PR --repo $SANDBOX
   ```
8. **T4:** back to the happy scenario: Ctrl-C, `unset B_SCENARIO`, then `nit-b start 2>&1 | perl "$REPO/docs/acceptance/stamp.pl"`.

- [x] **A security point escalated** (`check.sql` section 6: P1 `escalated` with reason `category` before Continue).
- [x] **Continue let the agents run one more round on it:** an address job and a re-review after the Continue, and P1 `resolved`.
- [x] **On the second escalation, Resolve made the chat ready:** P2 resolved by NikosGkikas13, the chat `ready` (section 1).
- [x] ngkdev93-jpg never saw a **Resolve** button.

## 7. Read-only, and a 404 (no agent runs)

### 7.1 Someone who can read the repo but isn't in the chat sees it read-only

The sandbox is public, so everyone can read it. NikosGkikas13 isn't in a chat for a PR that doesn't ask NikosGkikas13 to review it.

1. **T5:** a PR with no reviewer (ask first: writes to GitHub):
   ```bash
   cd "$CLONE_A" && bash "$REPO/docs/acceptance/new-branch.sh" readonly && cd "$REPO"
   GH_TOKEN=$(gh auth token --user ngkdev93-jpg) gh pr create --repo $SANDBOX --head acc/readonly --base main \
     --title "Plan 2: read-only" --body "Plan 2 acceptance run."
   ```
   `PR=…`. Nothing runs: nobody was asked to review.
2. **NikosGkikas13's browser:** the PR is **not** in NikosGkikas13's inbox (neither tab). Type the chat's address into the address bar: `$TUNNEL/c/NikosGkikas13/nitpilot-sandbox/<PR>` (in T5, `echo $TUNNEL/c/$SANDBOX/$PR` prints it). The chat opens: the PR's title, the timeline. Where the message box would be, it says *You're reading along. Only the author and the reviewers can message the agents.* There is no Auto switch in the header and no buttons in the timeline.
3. **ngkdev93-jpg's browser:** the same address shows the chat with the *Auto-fix* switch and the message box (ngkdev93-jpg is the author).
4. **T5:** `gh pr close $PR --repo $SANDBOX`.

- [x] NikosGkikas13 saw the chat read-only: no message box, no Auto switch, no action buttons, and not in the inbox.

### 7.2 Someone who can't read the repo gets a 404

This needs a repo ngkdev93-jpg can't read: a private one of NikosGkikas13's, made for this check and deleted after it. **Ask first:** it creates a private repo in NikosGkikas13's account, a branch and a PR in it, and deletes the repo at the end.

1. **T5:** make the repo, a branch with one file, and a PR, all as NikosGkikas13 (`gh`'s own account):
   ```bash
   PRIV=NikosGkikas13/nitpilot-private-check
   gh repo create $PRIV --private --add-readme --description "Nitpilot Plan 2 acceptance: a repo ngkdev93-jpg can't read"
   MAIN=$(gh api repos/$PRIV/git/ref/heads/main --jq .object.sha)
   gh api -X POST repos/$PRIV/git/refs -f ref=refs/heads/acc/private -f sha=$MAIN
   gh api -X PUT repos/$PRIV/contents/notes.md -f message="A private note" -f content="$(printf 'private\n' | base64)" -f branch=acc/private
   gh pr create --repo $PRIV --head acc/private --base main --title "Private check" --body "Plan 2 acceptance run."
   gh api repos/$PRIV/collaborators --jq '.[].login'
   ```
   The last line prints only `NikosGkikas13`.
2. **T5:** the app must see the repo: `dbq -c "select \"fullName\", private from \"Repo\" where \"fullName\" = '$PRIV'"` prints one row within a few seconds (GitHub tells the server about a new repo when the app is installed on all of NikosGkikas13's repos). If it prints no row, the app is installed on chosen repos only: **NikosGkikas13's browser** → `https://github.com/settings/installations` → **Configure** next to *nitpilot-dev* → under **Repository access**, *Only select repositories* → **Select repositories** → type `nitpilot-private-check` and click it → green **Save**. Then run the `dbq` line again. If the PR opened before the repo was added, push nothing more: close the PR and open a second one on a new branch `acc/private2` the same way.
3. **NikosGkikas13's browser:** open `$TUNNEL/c/$PRIV/1` (or the number `gh pr create` printed). The chat opens: NikosGkikas13 wrote the PR.
4. **ngkdev93-jpg's browser:** open the same address. The page shows **Nothing here** / *This chat doesn't exist, or your GitHub account can't see its repo.* Then open `$TUNNEL/c/$PRIV/999` (a PR that doesn't exist): exactly the same page.
5. **T5:** clean up (ask first): `gh pr close 1 --repo $PRIV`, then delete the repo. `gh repo delete $PRIV --yes` needs the `delete_repo` permission; if it refuses, run `gh auth refresh -h github.com -s delete_repo` yourself (it shows a code to approve in the browser), or delete it in **NikosGkikas13's browser**: the repo → **Settings** (top tabs) → scroll to the red **Danger Zone** → **Delete this repository** → follow the prompts.

- [x] ngkdev93-jpg got the not-found page for the private repo's chat, the same page as for a PR that doesn't exist.
- [x] The private repo is deleted.

## 8. Wrap up

1. **NikosGkikas13's browser:** remove the tunnel's callback URL from the app: `https://github.com/settings/apps/nitpilot-dev` → **Identifying and authorizing users** → next to the `…trycloudflare.com/auth/github/callback` box, click its **Remove** button (leave the development one) → **Save changes** at the bottom.
2. **NikosGkikas13's iPhone:** the Home Screen app points at an address that dies with the tunnel. Press and hold its icon → **Remove App** → **Delete App** (or **Remove from Home Screen**).
3. **T5:** every PR of this run is closed: `gh pr list --repo $SANDBOX --state open` prints nothing of this run's (`Plan 2: …`).
4. Stop T1 to T4 (Ctrl-C).
5. Fill in section 9. Keep this file as the record of the run.
6. **T5:** drop the database: `docker exec nitpilot-postgres-1 psql -U nitpilot -d postgres -c "drop database $ACC_DB"`. Your dev database was never touched.

## 9. Results

Run on: 2026-10-20, 08:35–10:20 UTC, with Nitpilot at commit `6225cd4` (the fixes below landed during the run, at `74c4e6d` and `a0a1bc5`). Agent ngkdev93-jpg: Claude Code 2.1.277 through the built CLI; agent NikosGkikas13: the fake agent from source. Desktop: Chrome 155.0.8059.85 on macOS 15.1. Phone: iPhone on iOS 16.7 (Safari 16.6). Tunnel: `https://dealers-mason-madonna-scene.trycloudflare.com`. PRs: sandbox #11 (section 4), #12 (5), #13 (6), #14 (7.1), and `nitpilot-private-check` #1 (7.2, repo deleted after).

**Criteria** (spec §20, Plan 2 acceptance), each with its evidence:

| Criterion | Section | Evidence |
|---|---|---|
| The inbox and an open chat update live while the agents work, including the progress line, without a reload | 4 | PR #11 appeared in both inboxes and the chats followed the run with no reload: the note showed in the other browser at once, and the progress line (*…'s agent is reviewing… / is …*) moved in both browsers while Claude worked (09:20:28–09:21:20), with the inbox pills changing (seen by the person) |
| With Auto off, a reviewer draft and an author draft (with its diff) wait for Send; Send puts the reviewer's points into the chat and pushes the author's commit, authored by ngkdev93-jpg | 5 | PR #12: `check-web.sql` §1 both `auto` f. The review waited as a draft card, Send put P1–P3 in the chat. Claude's fix waited as *Draft … Not pushed* with the `orders.js` diff while GitHub's head stayed `e92c9f2` and the clone held one `refs/nitpilot/drafts/…`; Send ran a `publish` job that pushed `9ad3f64`, author `ngkdev93-jpg`, and the draft ref was gone after. The re-review's draft was sent, chat `ready`. §2: review, address, publish, re_review all `applied` |
| A security point escalates; Continue runs one more round; on a second escalation Resolve makes the chat ready | 6 | PR #13: P1 `escalated` (reason `category`) at 10:01:38, red banner in both browsers, **Resolve** only in NikosGkikas13's. ngkdev93-jpg's **Continue** → address (Claude pushed `9872c50`, a parameterized query) → re-review: P1 resolved, P2 escalated → NikosGkikas13's **Resolve** → `ready`, round 2 |
| A note sent from the composer reaches the agents' next job | 4, 5 | Section 4 (#11): the note reached the address job's bundle, but Claude refused it: *"Did not act on the PR note… since it was untrusted PR text"*. Fixed in `74c4e6d` (an agent's own person's notes are theirs to follow). Section 5 (#12), same note written at 09:56:28 before the address job at 09:56:48: the pushed `orders.js` starts with `// checked in the Plan 2 acceptance run` |
| A failed job shows Retry, and Retry runs it again | 4 | PR #11 on `crash.json`: attempts at 09:08:02, 09:08:39, 09:09:44, then `failed` (`crash`, attempt 3) and the amber **Your agent couldn't finish** banner with **Retry** in NikosGkikas13's browser only. Retry at 09:20:25: timeline *NikosGkikas13 asked their agent to try again*, a second review `done` |
| Web Push arrives on desktop Chrome and on the iPhone (Home Screen app), and clicking it opens the chat; with push on, the CLI shows no OS notification | 3, 4 | `check-web.sql` §4: *Chrome on macOS* (`fcm.googleapis.com`) and *Safari on iPhone* (`web.push.apple.com`). At *Ready* (09:21:23.774, T4 `🔔`) both devices showed the notification and clicking each opened chat #11; no Script Editor notification for NikosGkikas13. ngkdev93-jpg (no push) did get the CLI's Script Editor notification in section 6, as it should |
| Someone who can read the repo but isn't a participant sees the chat read-only; someone who can't gets a 404 | 7 | #14 (no reviewer): not in NikosGkikas13's inbox; its address showed *You're reading along…*, no Auto switch, no buttons; ngkdev93-jpg saw the composer and Auto-fix. `nitpilot-private-check` #1 (collaborators: NikosGkikas13 only): NikosGkikas13 saw the chat, ngkdev93-jpg got *This chat doesn't exist, or your GitHub account can't see its repo.*, the same page as for PR 999. Repo deleted after (GitHub answers 404) |

**What was found and fixed during the run** (each with its commit):

- **An agent refused its own person's note** (section 4): every note was wrapped as untrusted text, so Claude read the author's request and declined it. `74c4e6d`: `get_job` marks each note `fromYou`; the notes of the person the agent works for come as plain text to act on, everyone else's stay untrusted (so a fork PR's author still can't steer the reviewer's agent). Spec §11 and docs/why/prompt-injection.md updated. Checked live in section 5.
- **The server's tests read the developer's push keys** (section 0 put real VAPID keys in `apps/server/.env`, which `vitest.config.ts` loads): two env tests failed. `a0a1bc5`: `TEST_ENV` blanks the three keys.
- This runbook, corrected where the run showed it wrong: type the tunnel address with `https://` (Safari, see section 3); GitHub now says **Redirect URI**; `healthz` answers JSON; with both people on Nitpilot the reviewer's points stay in the chat, not on GitHub (section 5); say which switch ngkdev93-jpg turns off. `check.sql` §3 no longer counts a failed job and its Retry as a duplicate.

**Seen, not fixed** (deferred):

- **Sign-in over plain http fails without a word of why.** Safari on the Mac and the iPhone loaded the tunnel address typed without `https://` over http; the `Secure` sign-in cookie was dropped, and the callback said *This sign-in link expired or was changed*. With `https://` it works. Production sits behind a proxy that redirects http (Plan 3); a fix would send `/auth/github/login` to `PUBLIC_URL` when the request came in on another address.
- **A resent webhook can bring back a merged PR.** At the first boot the server asked GitHub to resend 3 deliveries that had failed while no tunnel ran (the app is also installed on `NikosGkikas13/nitpilot`). The resent `closed` of `nitpilot` #1 was processed before an older `synchronize`, ignored as untracked, and the `synchronize` then created a chat for the merged PR, which sits idle in the inbox.
- **A re-review right after our own push fails once with `stale_head`** (sections 5 and 6): it starts before GitHub reports the new head, and runs again 10 s later without counting as an attempt. Harmless.
- `gh pr create --reviewer` failed once with a GraphQL error (section 4); the REST fallback in step 2 worked.
- The server log showed the known `ChatRead_userId_chatId_key` unique-constraint errors (a mark-read race; deferred before this run).

**The phone:** the Home Screen app needed its own sign-in (it keeps its own cookies, apart from Safari's), and the push arrived on the iPhone as on the Mac and opened the chat (the delay wasn't timed; it came while the person was watching both).

**Ticks:** every box in sections 0 to 8 is ticked.
