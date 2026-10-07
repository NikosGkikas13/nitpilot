# Handoff: Nitpilot web app (Plan 2)

## Overview
Nitpilot lets developers' AI agents (Claude Code, Gemini CLI) review each other's pull requests the moment they open. It only pings humans when there's a decision to make: approve, settle a disagreement, or judge a security point. The web app is a calm, messenger-style PWA: an inbox of PRs on the left and one chat per PR on the right. This bundle covers every web screen in the design brief (§5), all component states (§7), the edge states (§6.2), and the brand mark, icon and splash.

## About the design files
The files in this bundle are **design references built in HTML**. They are working prototypes that show the intended look and behavior, not production code to copy. Rebuild them in the Plan 2 web-app stack using its own patterns: component library, state management, routing. If no stack exists yet, a React + TypeScript PWA (Vite or Next) with CSS variables for theming is a good fit.

Open `Nitpilot Canvas.dc.html` in a browser to see everything; it needs `support.js` in the same folder. **Turn 3 (top of the canvas) is the chosen direction.** Turns 1–2 are earlier explorations; ignore them except as history.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, copy and interactions are final. Recreate them pixel-accurately. All sample content (Maya Chen, PRs #136–#151) is the brief's §9 data and should become real data.

## Chosen direction
- Visual system: **Soft signal**. Sage neutrals, a single deep-teal accent, Bricolage Grotesque + Fragment Mono, generous rounding.
- Chat layout: **single-column feed**. Everyone is left-aligned like an activity log, and point cards are full width. A bubbles layout also exists in the prototype (`layout="bubbles"`) but was not chosen.
- Mark: **dotted n**. The wordmark is `nıtpilot` in Fragment Mono, with a teal diamond as the dot on the i. The icon is a mono "n" with the diamond.

---

## Design tokens

### Fonts (Google Fonts)
- Sans (all UI): `"Bricolage Grotesque", system-ui, sans-serif`. Load opsz 12..96, weights 400/500/600/700.
- Mono (code, paths, branches, hashes, commands, ids, wordmark): `"Fragment Mono", ui-monospace, monospace`. Weight 400 only.

### Type scale
| Role | Size / weight | Notes |
|---|---|---|
| Landing hero | clamp(34px, 4.6cqw, 60px) / 700 | letter-spacing −0.035em, line-height 1.02 |
| Page title (onboarding, approval) | 26–34px / 700 | −0.025em |
| PR title, desktop chat header | 17.6px (16 × 1.1) / 700 | −0.01em, single line, ellipsis |
| PR title, phone chat header | 20.9px (19 × 1.1) / 700 | wraps, line-height 1.2 |
| Section heading (settings) | 16px / 700 | |
| Point title | 14.5px / 600 | line-height 1.35 |
| Body | 14px / 400 | line-height 1.4–1.5 |
| Secondary / meta | 12–13px / 400 | `--fg3` |
| Mono | 11.5–13.5px | code snippets 12px with a 20px line height |
| Eyebrow | mono 10.5–11px, uppercase, letter-spacing 0.1em | |

### Color (CSS custom properties; both themes are first-class)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #eef2ee | #0f1412 | chat canvas, page background |
| `--side` | #f7f9f6 | #121815 | inbox sidebar, details panel |
| `--surface` | #ffffff | #18201c | cards, header, composer, inputs |
| `--muted` | #e8ede7 | #222b26 | avatars, neutral pills, tracks |
| `--hover` | #eef2ed | #1c2420 | row hover |
| `--sel` | #e6ece6 | #202925 | selected inbox row |
| `--fg1` | #16201b | #e8efea | primary text |
| `--fg2` | #44514a | #bfcac3 | secondary text |
| `--fg3` | #5f6c65 | #93a198 | meta (AA on surface) |
| `--fg4` | #9aa59f | #5f6c65 | decorative only, never essential text |
| `--b1` | #dfe6df | #2b3630 | borders (1px) |
| `--b2` | #edf1ec | #1f2823 | subtle dividers |
| `--acc` | #16707f | #5cc3d1 | the one accent: primary buttons, unread dot, count badge, switch on, focus ring |
| `--on-acc` | #ffffff | #06191c | text on accent |
| `--acc-tint` | #e0f0f2 | #13292c | "Needs you" pill background, tips |
| `--acc-text` | #0f6170 | #86d6e1 | links, accent text on tint |
| `--acc-line` | #b7dbe0 | #245055 | accent borders (own bubbles) |
| `--bubble` | #dcefef | #13292c | your own human notes |
| `--hl` | #e0f0f2 | #13292c | highlighted lines in code snippets |
| `--code` | #f7f9f6 | #121815 | code block / command background |
| `--ok` / `--ok-fg` / `--ok-tint` | #2f9e5b / #1f7444 / #e3f3e8 | #3fbf74 / #62d293 / #13261b | Ready, resolved, fixed, + diff |
| `--warn` / `--warn-fg` / `--warn-tint` | #e09a1a / #93600a / #fbf0d9 | #efaa34 / #f3bf62 / #2a2213 | major severity, failures, last round, edge banners |
| `--red` / `--red-fg` / `--red-tint` / `--red-line` | #d6453a / #b3322a / #fbe9e6 / #f1c6c0 | #ef5e52 / #ff8579 / #2b1715 / #5a2a25 | **only** escalations and blocker points, − diff, Revoke |

Rule: red is never used for routine activity. Failures are amber. Status is always icon + word, never color alone.

### Radii, borders, shadows
- Cards `16px`, controls/buttons `12px`, inputs/composer `18px`, chips/pills `999px`, avatars and dots `999px`, bubbles `20px` with a `6px` tail corner. Small severity and status badges inside point cards use `999px` (chip).
- Borders are 1px `--b1`. Dividers are 1px `--b2`.
- Card shadow (light only): `0 1px 2px rgba(16,32,24,.05), 0 6px 20px rgba(16,32,24,.06)`. Dark: none.
- Popovers and toasts: `0 8px 24px rgba(0,0,0,.12)` / `0 6px 20px rgba(0,0,0,.18)`.

### Spacing
A 4px base. Common values are 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32 and 40. The desktop chat timeline uses 22px 24px padding with a 14px gap between items; phone uses 16px 12px. Inbox rows have 11px 10px padding with a 12px gap between avatar and text.

### Motion
- Agent-working ping: a 7px accent dot with a ring that scales 1→2.6 and fades out, over 1.6s with `cubic-bezier(0,0,.2,1)`, looping.
- Switch thumb: `transform 150ms`. Track: `background-color 150ms`.
- Spinner (onboarding waiting): 0.9s linear rotation.
- `prefers-reduced-motion: reduce` disables all animations and transitions.

---

## App shell and layout
- **Desktop (≥760px):** a full-viewport flex row.
  - Inbox sidebar: 360px wide, `--side`, 1px right border.
  - Chat: flexible, `--bg`.
  - Optional details panel: 300px, `--side`, 1px left border. Toggled from the header and auto-hidden below 1180px.
- **Phone (<760px):** the inbox fills the screen. Opening a PR replaces it with the chat, which has a back arrow (‹, 44×44). The chat header collapses on scroll (scrollTop > 48): the full header (ref, title, branch, role, round, presence) shrinks to one line (back, truncated title, Auto switch). The Auto switch stays visible in both states.

## Screens / views

### 1. Inbox (sidebar / phone screen). Canvas 3a
Top to bottom:
1. **Header row** (padding 14px 16px 10px): the wordmark `nıtpilot` (mono 19px, 5px teal diamond centered over the ı), a spacer, a theme toggle (32×32, 1px border, 12px radius), and the user avatar (32px circle, "MC") linking to settings.
2. **Offline banner**, shown when the user's CLI isn't connected: a card in 12px margins with an outlined ring dot and the text "Your agent is offline", then "Run `nitpilot start`" with a copyable chip (Copy → "Copied" for 1.6s).
3. **GitHub-expired strip** (edge state): amber tint, "!" glyph, "GitHub sign-in expired", and a dark "Reconnect" button.
4. **Search + Filter:**
   - Search input: 34px tall, magnifier icon, placeholder "Search pull requests". A `/` kbd hint shows on desktop.
   - Filter button: "Filter", or "Filter · N" with an accent border when active.
   - Filter popover (220px): Repo (acme/shop-api ✓), then status checkboxes: Needs you, Agent working, Waiting, Their turn, Ready, Closed.
5. **Tabs** "To review" and "Mine": 40px tall, 2px bottom border on the active tab. The count badge shows only items that need the user (18px accent pill, `--on-acc` text) and is hidden at 0.
6. **List rows.** "Needs you" items sort first. Each row has:
   - A 38px avatar of the other person. A 15px agent badge (a dark rounded square holding a 5px diamond) sits bottom-right when their agent is active.
   - Line 1: mono `acme/shop-api #142` and the time on the right.
   - Line 2: the title (14px, 500, or 600 when unread), ellipsis, and an 8px unread dot in the accent color.
   - Line 3: the status pill, the last activity (12.5px `--fg3`, ellipsis), and the round `2/3` in mono 11px.
   - States: hover `--hover`, selected `--sel`, keyboard cursor `inset 0 0 0 2px var(--acc)`.
7. **Empty state:** a 10px diamond in `--b1`, "All quiet.", then "Nitpilot will ping you when you're needed." Search shows "No matches" with "No pull requests match "…"."
8. **Footer** (desktop): "j k move · ↵ open · / search".

**Status pills** (20px tall, 7px horizontal padding, 11.5px / 500):
| Pill | Bg / text | Glyph |
|---|---|---|
| `Leo's agent working` | muted / fg2 | animated ping dot (accent) |
| `Waiting` | muted / fg2 | 7px outlined ring |
| `Their turn` | muted / fg2 | ring |
| `Needs you` | acc-tint / acc-text | 6px accent dot |
| `Needs you` (escalation) | red-tint / red-fg | 6px red diamond |
| `Ready` | ok-tint / ok-fg | ✓ |
| `Merged` | transparent / fg3, line-through | none; the row title also turns fg3 |

### 2. PR chat. Canvas 3a
**Header** (surface, 1px bottom border, padding 12px 20px):
- Row 1: the PR title, a role chip (`Author` / `Reviewer`, muted), and the **Auto switch**. It's a pill button (30px tall) labelled "Auto-review" for reviewers or "Auto-fix" for authors, holding a 30×18 track and a 14px thumb.
  - On: accent track.
  - Off: `--b1` track.
  - Disabled by team: `--muted` track, a `--b1` thumb, `--fg3` label, and a `not-allowed` cursor. A tooltip (250px, inverted colors) reads "Off for PRs from outside contributors. Your team set this in .nitpilot.yml." Toggling shows a toast.
  - Row 1 continues with "Open on GitHub ↗" and a details-panel toggle.
- Row 2 (12px `--fg3`): mono `acme/shop-api #142`, then mono `feature/cursor-pagination → main`.
  - Round indicator: one 10×4px pip per allowed round (accent when used, `--b1` when not; all amber on the last round) plus "Round 2 of 3".
  - Presence: a green dot for "Leo's agent · online", an outlined ring for "offline since 18:04", or the ping for "reviewing".

**Banners**, pinned under the header and full width:
- Author ready: ok-tint, ✓ in an 18px green circle. "Waiting for Leo's approval" / "2 rounds · 3 points resolved". A secondary button "View on GitHub ↗".
- Reviewer ready: same, but titled "Ready for your approval", with a **primary** "Approve on GitHub ↗". Approval always happens on GitHub.
- Escalated: red-tint with a red-line border. A 9px red diamond and "Needs a human decision", plus "Security points always go to a person." Each escalated point is a surface row: red mono id `P1`, the title, a "Resolve" button (dark fill) and a "Continue" button (outlined).
  - Resolve sets the point to resolved, adds the system line "You resolved P1", and turns the banner into the reviewer-ready banner.
  - Continue adds "You let the agents continue on P1" and "Round 3 started · last round", shows a progress line, and sets the pill to working.
- Waiting: muted, outlined ring, "Waiting for your agent" / "Offline since 18:04…", plus a copyable `$ nitpilot start` chip.
- Failed (component sheet): warn-tint, "!", "Your agent couldn't finish" / "Gemini quota reached", plus "Retry".
- Edge banners (§6.2): see "Edge states" below.

**Timeline (feed)**, max-width 780px, centered:
- **System event:** a 28px glyph column, then 12px `--fg3` text, with the time right-aligned and tabular. Glyphs: dot (default), ✓ (ready/merged), ring (offline/queued), red diamond (escalated). Commit hashes are inline mono `--fg2`.
- **Agent summary:** a 28px avatar with the agent badge, then a name line ("Leo's agent", "Gemini CLI", time), then 14px text and mono severity counts ("1 major · 1 minor · 1 nit").
- **Human message:** same header, sub-label "to the agents". The text sits in a box: surface with a `--b1` border for others, `--bubble` with an `--acc-line` border for your own.
- **Point card:** indented 38px under its summary. See Point card below.
- **Live progress line:** a ping dot, then "Leo's agent is reviewing… reading", then the file name in mono `--fg1`. The file name updates in place every 2.4s. `role=status aria-live=polite`.
- **Untrusted PR card** (first-time contributor): an eyebrow with a ring and "FIRST-TIME CONTRIBUTOR", the title "Your agent hasn't started", and the body "Nitpilot doesn't run agents automatically on PRs from outside contributors. Skim the diff, then start the review yourself." A mono line reads "3 files · +412 −0 · locales/tr.json". Buttons: primary **Review**, and "View diff on GitHub ↗". When the user's agent is offline, Review queues the run (system line plus a "Waiting" pill).

**Composer** (surface, 1px top border):
- A rounded 18px field on `--bg` with the placeholder "Message the agents…" and a Send button. Send is muted when empty and accent when there's text; ↵ sends and ⇧↵ adds a new line. The field border turns accent on focus.
- Hint line: "Notes are included in the agents' next round". Sent notes appear as your human message, with the toast "Sent. Included in the agents' next round."
- Read-only state (merged PR, or GitHub expired): centered `--fg3` text instead of the field.

**Details panel** (desktop):
- Files changed: a card of mono rows (path truncated from the left, `+n` green, `−n` red) with a header "6 · +123 −15".
- Participants: avatar, name, role, and agent + presence.
- Team rules from `.nitpilot.yml`: Max rounds 3, Always escalate `security`, Auto modes Allowed.
- A "Summary comment on GitHub ↗" link.

### 3. Point card (`PointCard.dc.html`), the key component
- **Expanded:** a surface card with a 1px `--b1` border (`--red-line` when escalated), 16px radius and the card shadow.
  - Header row: a severity badge (22px; four 2.5px-wide bars 4/6/8/10px tall, filled to the severity level, plus the word), a category chip (mono, outlined), the mono id `P1`, a spacer, then the status (glyph + word) and a collapse ▴ control when resolved.
  - `src/orders/list.ts:48`: a mono accent-text link.
  - Title 14.5/600, then the explanation 13.5px `--fg2`.
  - Code snippet: a `--code` block with a header bar (path, then `L47–49`). Lines are 12px mono on a 20px line height with a 46px line-number gutter. **Referenced lines get a `--hl` background, accent line numbers, and a 6px accent diamond in the gutter.**
  - Light syntax colors: keywords acc-text, strings ok-fg, numbers warn-fg, comments fg3.
  - Thread: on `--bg` with a top divider. Each reply has a 22px avatar (with agent badge), the name, an outcome tag, an optional commit link (mono, underlined), the time, and the text.
- **Severity:** blocker = red (4 bars), major = amber (3), minor = neutral fg2 (2), nit = neutral fg3 (1).
- **Status:**
  - Open: outlined circle, `--fg2`.
  - Addressed: half-filled accent circle, acc-text.
  - Resolved: green ✓ circle, ok-fg.
  - Escalated: red diamond, red-fg.
- **Outcome tags:** `Fixed in <hash>` (ok-fg), `Declined` (fg2), `Resolved` (ok-fg), `Kept open` (warn-fg), `Answered` (acc-text).
- **Collapsed (the default for resolved points):** one 9px×12px row: ✓, id, title (ellipsis), mono outcome ("Fixed · a1b2c3d" / "Declined"), "Resolved", ▾. Click to expand.

### 4. Landing + sign-in (`NitpilotScreens`, screen=landing). Canvas 3b
- Nav: wordmark 22px, Docs, GitHub ↗.
- Hero (two columns that wrap):
  - An eyebrow pill ("For Claude Code and Gemini CLI" with a diamond).
  - H1: "Your agents review each other's PRs the moment they open."
  - Sub: "You only hear about it when there's a decision to make."
  - CTA: **Sign in with GitHub →** (52px, 14px radius, ink fill), then a mono note: "Free for public repos · Open source · Self-host for private repos".
  - Right column: a product card with three real inbox rows (#139 Needs you, #147 working, #142 Ready).
- "How it works": three cards (28px numbered circle, title 17/700, body 14px):
  - "A review is requested"
  - "The agents talk it out"
  - "You make the call"

### 5. Onboarding checklist (screen=onboarding). Canvas 3c
- Title "Set up Nitpilot" / "This list ticks itself off as each step completes." A progress bar (6px, accent) with "N of 5".
- A checklist card of five rows. Each row has a 26px status icon: done = green ✓ (title fg3), waiting = spinner, pending = outlined number. Rows can carry a command block (44px, `--code`, `$` prefix, Copy button while active).
  1. Sign in with GitHub. Done, "Signed in as @mayachen."
  2. Install the GitHub App on your repos. Done. Note: nitpilot.dev covers public repos only.
  3. Connect your computer. `npx nitpilot login`, then "Waiting for your terminal…", then "✓ Connected: Maya's MacBook Pro". **It must advance automatically when the CLI connects**; the prototype fakes this 2.2s after Copy.
  4. Link a repo. `nitpilot repos add`, run inside the clone.
  5. Start your agent. `nitpilot start`, with chips for Claude Code and Gemini CLI that read "detected automatically".
- "Skip for now".

### 6. CLI approval (screen=approve, state=pending|approved|denied|expired). Canvas 3d
A centered 440px card (24px radius):
- **Pending:** "Device login" eyebrow. "Approve this device?" / "Check that this code matches the one in your terminal." The code **WDJB-MJHT** is in mono, clamp(30px, 9cqw, 38px), letter-spacing 0.14em, in a `--code` box. Device row: "Maya's MacBook Pro" / "macOS · nitpilot CLI 0.9 · requested 18:02". Buttons: **Approve** (accent, 48px) and Deny (outlined). Fine print: "Only approve if you just ran npx nitpilot login. The code expires in 9:41."
- **Approved:** green ✓ in a 56px circle. "Device approved" / "…You can close this tab."
- **Denied:** × in a muted circle. "Login denied" / "Nothing was connected…"
- **Expired:** ring. "This code expired" / "Codes last 10 minutes…", followed by the `npx nitpilot login` command block.

### 7. Settings (screen=settings). Canvas 3e
- Top bar: "‹ Inbox" and "Settings".
- Desktop has a 180px section nav: Devices, Agent, Notifications, Defaults, Account. Sections are 18px-radius cards.
- **Devices:** "Maya's MacBook Pro" with a `This device` chip, "Last seen 18:04". "maya-linux-desk", "Last seen 3 days ago", with **Revoke** (red text, outlined).
- **Agent:** "Claude Code v2.1" with a `✓ Logged in` ok chip. "Gemini CLI" with a `! Not found` warn chip and "Install it, then run nitpilot start again."
- **Notifications:** a Push switch (46×28), and an iOS tip in an acc-tint box: "On iPhone? Add Nitpilot to your Home Screen to get notifications…"
- **Defaults for new chats:** Auto-review (on), Auto-fix (off). Daily job cap: "Max 40 agent runs per day · 12 used today" with a usage bar and a −/+ stepper in steps of 5, range 5–200.
- **Account:** avatar, "Maya Chen", mono `github.com/mayachen`, **Sign out**.

### 8. Push notifications (screen=push). Canvas 3f
iOS-style cards (22px radius, 38px app icon). Desktop shows them stacked top-right over the editor. Copy:
- "Ready for your approval" · "acme/shop-api #142: 2 rounds, 3 points resolved"
- "Needs you" · "#139: a security point needs a human decision"
- "Review waiting" · "#151 from a first-time contributor"
- "Agent failed" · "#147: Gemini quota reached. Retry?"

### 9. PWA (screens install, home, splash). Canvas 3g
- **Desktop install prompt:** a 380px card bottom-left with a 52px icon. "Install Nitpilot" / "Its own window next to your editor, with notifications when you're needed." Buttons: Install (accent), Not now.
- **iOS Home Screen hint:** a bottom sheet with 28px radius and a grabber. Icon plus "Add Nitpilot to your Home Screen" / "On iPhone, notifications only work from the Home Screen app." Three numbered steps (Share → Add to Home Screen → open and allow notifications), then "Got it".
- **App icon:** #16707f, rounded square (~23% radius). A white Fragment Mono "n" with a #a8e3ea diamond at the top right. Drop the diamond below 32px.
- **Splash:** light is a #16707f background with a #0f5d6a icon plate; dark is #0f1412 with a #16707f plate. Both show a 108px icon, the 26px wordmark below, and "Loading your inbox…" near the bottom. Manifest `theme_color` #16707f, `background_color` #16707f (light).

### 10. Edge states (§6.2). Canvas 3i (`NitpilotApp` prop `edge`)
- `github`, sign-in expired:
  - Inbox strip plus chat banner (warn): "GitHub sign-in expired" / "Nitpilot can't approve, post or push as you until you reconnect. Agents keep working in the meantime." Button: **Reconnect GitHub**.
  - **Blocks actions taken as the user:** the composer becomes read-only ("Reconnect GitHub to send notes as yourself."), and Resolve and Approve show a toast instead.
- `rules`: a centered warn chip under the header: "! `.nitpilot.yml` has an error, using defaults", plus a "Line 7" link.
- `cap`: a warn banner, "Daily agent cap reached" / "40 of 40 agent runs used today. Agents pick up again at midnight, or raise the cap in Settings." Button: **Raise cap** (links to settings).
- `repo`: a muted banner, "acme/shop-api isn't linked on this computer" / "Your agent can't review or fix this PR until the repo is linked. In your clone, run:", with a copyable `nitpilot repos add` chip.
- Untrusted PR: see the untrusted card in the PR chat section.

### Toasts
Inverted (`--fg1` background, `--bg` text), 13px, 8px 12px padding, centered 96px above the composer, auto-hide after 2.6s, `role=status`. Variants: plain, with an action ("Undo" in acc-line), and error (red diamond plus text).

---

## Interactions & behavior
- **Keyboard:** `j`/`k` (or ↓/↑) move the inbox cursor, `Enter` opens, `/` focuses search, `Esc` returns to the inbox on phone or closes the filter. Shortcuts are ignored while typing in inputs.
- **Focus:** `:focus-visible` gets a 2px accent outline with 2px offset on every interactive element.
- **Accessibility:**
  - Switches use `role=switch` + `aria-checked`. Tabs use `role=tab` + `aria-selected`, and inbox rows use `role=option`.
  - Banners are `role=status`, except escalation, which is `role=alert`.
  - Count badges have aria-labels ("2 need you"), and the agent badge's label is "Leo's agent is active".
  - Every status combines a glyph and a word. Contrast is WCAG AA in both themes; `--fg4` is never used for essential text.
- **Reduced motion:** turn off the ping, the spinner and transitions.
- **Theme:** follow `prefers-color-scheme` by default, with a manual toggle in the sidebar header.
- **Who did what:** agents are always named as their owner's agent ("Leo's agent", "Your agent"), with the badge on the owner's avatar. Humans have no badge. System events are muted and use no avatar.

## State management (suggested)
- `inbox`: PRs with `{ id, repo, number, title, tab: 'review'|'mine', role, otherUser, otherAgentActive, status: 'working'|'waiting'|'their'|'needs'|'escalated'|'ready'|'closed', round: [current, max], lastActivity, updatedAt, unread }`. The tab count is the number of items in `needs | escalated | (ready && role==='Reviewer')`.
- `chat[prId]`: timeline items `sys | summary | human | point | progress | untrusted | draft`, `points[]` with `{ id, severity, category, file, line, title, body, snippet{start, hl[], code[]}, status, thread[] }`, plus `autoMode`, `presence`, `banner` (derived), and the composer draft.
- UI: selected PR, tab, cursor, search, status filter, the expanded point ids, theme, the phone screen (inbox|chat), and whether the header is collapsed.
- Realtime: agent presence, progress-line file names and new timeline items should stream in (WebSocket/SSE). The onboarding steps and the CLI approval page react to CLI events.

## Assets
There are no raster assets. The mark, icon, agent badge, severity bars and status glyphs are simple CSS shapes: circles, rounded squares, and a rotated square for the diamond. Export the app icon as SVG/PNG from the spec above (maskable, with the safe zone respected). Avatars are initials placeholders; use GitHub avatars in production.

## Files
- `Nitpilot Canvas.dc.html`: the overview of every screen and state. **Turn 3 is the spec.**
- `NitpilotApp.dc.html`: the clickable inbox and PR chat. Props: `skin` (use `soft`), `layout` (use `feed`), `theme`, `device`, `screen`, `startPr`, `edge`, `details`, `agentOnline`.
- `PointCard.dc.html`: the point card, expanded and collapsed.
- `NitpilotScreens.dc.html`: landing, onboarding, approve, settings, push, install, home, splash. Props: `screen`, `theme`, `device`, `state`.
- `ComponentSheet.dc.html`: every §7 component state (`skin="soft"`), in light and dark.
- `support.js`: the runtime the `.dc.html` files need to open in a browser. Not part of the product.
