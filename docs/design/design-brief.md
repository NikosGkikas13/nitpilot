# Nitpilot: design brief

For Claude Design. This brief covers the web app only; the backend and CLI are specified elsewhere and need no design. Bring back a design link plus component specs, and they will feed Plan 2 (building the web app).

## 1. The product in one paragraph

**Nitpilot** lets developers' AI agents review each other's pull requests the moment they open, and only pings the humans when there's a decision to make.

- **Rounds.** When someone requests your review, your own agent reviews right away, on your machine. When reviewers raise points on your PR, your agent fixes them and pushes.
- **One chat per PR.** The two agents go back and forth in a Messenger-style chat per pull request, so the PR on GitHub stays clean.
- **Humans step in only when needed:**
  - to approve when everything is resolved;
  - to settle a disagreement between the agents;
  - to judge a security concern.

**Tagline:** *Your agents review each other's PRs the moment they open. You only hear about it when there's a decision to make.*

## 2. Who uses it, and when

- **Who:** developers who use AI coding agents (Claude Code, Gemini CLI) and GitHub.
- **Desktop:** the app is open in a browser tab or as an installed web app next to their editor. They glance at it, as they would at a messenger.
- **Phone:** a push notification arrives ("Ready for your approval"), they open the app, read the outcome, and tap through to approve on GitHub.
- **The emotional promise is calm.** Most of the time nothing needs them, and the app should feel quiet and trustworthy, not like a busy dashboard.

## 3. Personality and visual direction

- **Familiar and calm.** It's a messenger, not an admin panel: inbox on the left, conversation on the right. Users should understand it in five seconds.
- **Quiet by default.**
  - Neutral surfaces with one accent color.
  - Status colors used sparingly.
  - **Red only for real escalations and blocker points.**
  - Never alarming for routine activity.
- **Developer-native.**
  - Monospace for code, file paths, branch names and commit hashes.
  - Code snippets look like a good diff viewer.
  - Clear, readable hierarchy.
- **Trustworthy automation.** It's always clear *who* did something: your agent, their agent, a human, or the system. Agents get a distinct but friendly treatment, such as a small badge on the owner's avatar ("Leo's agent").
- **Name and logo.** "Nitpilot" combines **nit** (the small code-review nitpick) and **autopilot**. Explore a wordmark and an app icon (also needed as the PWA home-screen icon). Hints: a calm autopilot, a guided path, a small marker on a line of code. Avoid literal airplane clichés.
- **Light and dark themes,** both first-class.

## 4. Glossary (concepts the UI shows)

| Term | Meaning |
|---|---|
| **PR chat** | One conversation per pull request |
| **Point** | One review comment raised by an agent (or a human on GitHub). It has a **severity** (blocker, major, minor, nit), a **category** (security, bug, performance, design, tests, style, docs, other), a file and lines, a code snippet, a title and an explanation |
| **Point status** | **open**, **addressed** (the author's agent replied: fixed, answered or declined), **resolved**, **escalated** (needs a human) |
| **Round** | One review pass and one fix pass. Shown as "Round 2 of 3"; teams set the limit |
| **Auto switch** | Per chat, for *your side*. As a reviewer it means auto-review; as an author it means auto-fix. When it's off, your agent's work waits as **drafts** for you to send |
| **Escalated** | The agents disagree, a point is security-related, or the round limit was hit. A human decides |
| **Ready** | Nothing open. Waiting for the human reviewer to approve on GitHub |
| **Agent presence** | Whether someone's agent is online (their CLI is running) or "offline since 18:04" |

## 5. Screens

Design every screen for **desktop and phone**, in **light and dark**.

### 5.1 Landing and sign-in

- A minimal page: the tagline, a short "how it works" (three steps or a small animation), and a **Sign in with GitHub** button.
- A small note: "Free for public repos · Open source · Self-host for private repos".

### 5.2 Onboarding checklist (first run)

A friendly checklist that **ticks itself** as each step completes, because the app detects when the CLI connects.

1. **Sign in with GitHub.**
2. **Install the GitHub App** on your repos. Note: public repos only on nitpilot.dev.
3. **Connect your computer.** Show a copyable command, `npx nitpilot login`, then a "waiting for your terminal…" state, then "Connected: Maya's MacBook Pro".
4. **Link a repo.** Inside your clone, run `nitpilot repos add`.
5. **Start your agent.** Run `nitpilot start`, then pick your agent (Claude Code or Gemini CLI, detected automatically).

### 5.3 CLI approval page

Reached from the terminal login.
- A one-card page: "Approve this device?"
  - the code to confirm, `WDJB-MJHT`, shown large;
  - the device name, "Maya's MacBook Pro";
  - **Approve** and **Deny** buttons.
- **States:** approved ("You can close this tab"), denied, expired.

### 5.4 Inbox

- **Layout:** on desktop, a left sidebar like Messenger. On phone, a full-screen list.
- **Tabs:** **To review** · **Mine**. Each tab has a count badge showing only the items that need the user.
- **Each row shows:**
  - the repo and number (`acme/shop-api #142`) and the PR title;
  - the other person's avatar, with an agent badge when their agent is active;
  - a **status pill** (§6.1);
  - the round ("2/3");
  - the last activity in one line ("Your agent pushed 2 commits");
  - the time;
  - an unread dot.
- **Sorting:** "Needs you" items at the top.
- **Extras:** a search box and a small filter (repo, status).
- **Empty state:** "All quiet. Nitpilot will ping you when you're needed."
- **Banner** at the top when the user's CLI isn't connected: "Your agent is offline. Run `nitpilot start`."

### 5.5 PR chat

**Header**
- PR title, `acme/shop-api #142`, and `feature/cursor-pagination → main` in monospace.
- The participants' avatars and the user's role chip (Author / Reviewer).
- An **Auto switch** labeled for the role: "Auto-review" or "Auto-fix". It shows a disabled state with a tooltip when the team's rules forbid auto modes.
- The round indicator: "Round 2 of 3".
- Agent presence: "Leo's agent · online", or "offline since 18:04".
- An **Open on GitHub** link.

**Timeline item types** (each needs a design):
1. **Point card**, the most important component:
   - a severity badge (blocker / major / minor / nit), a category chip and an id (`P1`);
   - the file and lines (`src/orders/list.ts:48`) and a title;
   - a short explanation;
   - a **code snippet** with the referenced lines highlighted;
   - a status (open, addressed, resolved, escalated);
   - a nested thread of replies, including outcomes such as "Fixed in `a1b2c3d`" (with a link), "Declined: …", "Resolved" and "Kept open: …".
   - Resolved points collapse to a single line by default.
2. **Agent summary message:** "Leo's agent reviewed 6 files and raised 3 points."
3. **Human message:** a note a person wrote to the agents ("skip naming nitpicks").
4. **System event:** small, centered and muted. Examples: "Round 2 started", "Your agent pushed 2 commits", "Leo's agent is offline since 18:04", "Escalated: P1", "Ready for approval".
5. **Draft:** only visible to its owner, styled visibly as unsent (for example, a dashed outline). Actions: **Send**, **Discard**. As a reviewer, a draft shows the points your agent wants to raise; as an author, it shows the fixes it wants to push, as a list of changed files.
6. **Live progress line** while an agent works: "Leo's agent is reviewing… reading `src/orders/list.ts`". Subtle and animated.

**Banners** (pinned under the header):
- **Ready:** "Ready for your approval: 2 rounds, 3 points resolved" with a primary **Approve on GitHub** button. The author sees "Waiting for Leo's approval" instead.
- **Escalated:** "Needs a human decision", listing the escalated points with **Resolve** and **Continue (let the agents keep going)** for each one.
- **Waiting:** "Waiting for Leo's agent (offline since 18:04)".
- **Failed:** "Your agent couldn't finish (quota reached)" with **Retry**.

**Composer:** "Message the agents…" with a hint that notes are included in the agents' next round.

**Optional right panel on desktop (PR details):**
- files changed with counts;
- participants and their agents;
- the team rules in effect (max rounds, always-escalate categories);
- a link to the summary comment on GitHub.

### 5.6 Settings

- **Devices:** connected computers, with last seen and Revoke.
- **Agent:** "Claude Code v2.1, logged in ✓", or an issue state ("Gemini CLI not found").
- **Notifications:** enable push. Include an iOS hint: "Add Nitpilot to your Home Screen to get notifications."
- **Defaults:** Auto-review and Auto-fix for new chats, and a daily job cap ("Max 40 agent runs per day").
- **Account:** GitHub login, sign out.

### 5.7 Push notifications (copy and visual check)

- "**Ready for your approval** · acme/shop-api #142: 2 rounds, 3 points resolved"
- "**Needs you** · #139: a security point needs a human decision"
- "**Review waiting** · #151 from a first-time contributor"
- "**Agent failed** · #147: Gemini quota reached. Retry?"

## 6. States to cover

### 6.1 Inbox status pills
| Pill | When | Tone |
|---|---|---|
| **Agent working** | An agent is running (show whose) | Subtle and animated |
| **Waiting** | The agent is queued or offline | Muted |
| **Their turn** | Waiting for the other human | Muted |
| **Needs you** | Escalation, manual review, drafts to send, or a failure | Accent (red only for escalations) |
| **Ready** | Waiting for approval | Positive |
| **Closed** | Merged or closed | Very muted, struck through or greyed |

### 6.2 Error and edge states
- **GitHub sign-in expired:** "Reconnect GitHub", blocking actions taken as the user.
- **Invalid team rules file:** a warning chip in the chat, ".nitpilot.yml has an error, using defaults".
- **Daily agent cap reached.**
- **Repo not linked on this computer:** "Run `nitpilot repos add` in your clone".
- **Untrusted PR** (from a first-time contributor): the agent doesn't start on its own. Show a **Review** button and a short explanation of why.

## 7. Component inventory (each with all states)

- Inbox row
- Status pill
- Tabs with count badges
- Avatar with agent badge
- Presence dot
- Auto switch (on, off, disabled by team)
- Round indicator
- **Point card** (each severity × each status, plus a collapsed resolved state)
- Code snippet block
- Reply / outcome row
- Agent summary message
- Human message bubble
- System event line
- Draft card
- Live progress line
- Banners (ready, escalated, waiting, failed)
- Composer
- Copyable command block
- Onboarding checklist item (pending, waiting, done)
- Device row
- Empty states
- Toast

## 8. Platform and accessibility

- **Installable web app (PWA).** Design the install prompt, the iOS "Add to Home Screen" hint, the app icon and the splash screen.
- **Mobile layouts:**
  - the inbox becomes a full screen, and the chat opens as a new screen with a back arrow;
  - the header collapses on scroll;
  - the Auto switch stays reachable.
- **Accessibility:**
  - WCAG AA contrast in both themes;
  - visible focus states;
  - full keyboard navigation (e.g. `j`/`k` through the inbox, `Enter` to open);
  - support for reduced motion;
  - status never conveyed by color alone (always icon plus text).

## 9. Sample content

Use this instead of lorem ipsum. The viewer is **Maya Chen** (`@mayachen`), on the team that owns `acme/shop-api`. Her agent is Claude Code.

**PR #142 · "Add cursor pagination to /orders"**
- **Situation:** Mine (Maya is the author). The reviewer is Leo Park (`@leopark`), whose agent is Gemini CLI. Branch `feature/cursor-pagination → main`. **Ready** after 2 rounds.
- **Timeline:**
  1. "Leo's agent started reviewing · 14:02"
  2. Summary: "Reviewed 6 files, raised 3 points"
  3. **P1** (major, bug) · `src/orders/list.ts:48` · "`parseCursor` throws on an empty cursor". Snippet:
     ```ts
     export function parseCursor(raw: string) {
       const [ts, id] = Buffer.from(raw, "base64url").toString().split(":");
       return { ts: new Date(Number(ts)), id };
     }
     ```
     Maya's agent: "Fixed in `a1b2c3d`: return `null` for empty or invalid cursors and treat it as the first page." Leo's agent: "Resolved."
  4. **P2** (nit, style) · `src/orders/list.ts:12` · "Rename `fetchAll` → `fetchPage`". Maya's agent: "Declined: `fetchAll` is part of the public SDK; renaming it would be a breaking change." Leo's agent: "Agreed, resolved."
  5. **P3** (minor, tests) · `test/orders.test.ts` · "No test for the last page (`nextCursor` should be `null`)". Maya's agent: "Fixed in `d4e5f6a`: added `returns null nextCursor on last page`." Leo's agent: "Resolved."
  6. Events: "Maya's agent pushed 2 commits · 14:09", "Round 2 started", "Ready for Leo's approval · 14:13"

**PR #139 · "Fix race in session refresh"**
- **Situation:** To review (Maya reviews Sam Okafor's PR, `@samokafor`). **Escalated.**
- **Points:**
  - **P1** (blocker, security) · `src/auth/session.ts:112` · "Refresh token stays valid after rotation, which opens a short replay window". Escalated automatically because security points always need a human.
  - **P2** (minor, tests) · Resolved.
- **Banner:** "Needs a human decision: P1".

**PR #151 · "Add Turkish translations"**
- **Situation:** To review. From `@deniz-dev`, a **first-time contributor**, so the agent didn't start on its own.
- **Shows:** a **Review** button and the line "Nitpilot doesn't run agents automatically on PRs from outside contributors."

**PR #147 · "Bump Prisma to 7.2"**
- **Situation:** Mine. **Agent working:** "Leo's agent is reviewing… reading `src/db/client.ts`".

**PR #144 · "Refactor webhook retries"**
- **Situation:** To review. **Waiting:** "Your agent is offline since 18:04. Run `nitpilot start`."

**PR #136 · "Remove legacy coupon endpoint"**
- **Situation:** Mine. **Closed**, merged yesterday.

## 10. Not in scope (don't design)

- A marketing site beyond the simple landing page.
- Billing, pricing, team or org admin.
- GitLab or other platforms.
- A desktop app.
- Approving or merging inside Nitpilot. Approval always happens on GitHub.

## 11. What to hand back

1. All screens in §5 for **desktop and phone**, in **light and dark**, filled with the §9 content.
2. A component sheet with every state from §7.
3. Wordmark and app-icon explorations, including the PWA icon and splash screen.
4. A design link to bring back to Claude Code for Plan 2.
