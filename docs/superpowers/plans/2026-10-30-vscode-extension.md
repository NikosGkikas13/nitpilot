# Nitpilot for VS Code: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code extension (`apps/vscode`) that shows the developer's open Nitpilot PRs in the status bar and a sidebar, opens each chat in the browser, and retries failed agents, published to the VS Code Marketplace and Open VSX.

**Architecture:** Two pure, tested modules (`poll.ts`: one poll of the server through the CLI's own `loadConfig` and `ServerClient`; `view-model.ts`: from a poll to status-bar and tree data), and one thin VS Code wiring file (`extension.ts`) that polls every 30 s while the window is focused. Bundled into one CommonJS file with tsup; released by its own `vscode-vX.Y.Z` tag.

**Tech Stack:** TypeScript, VS Code extension API (`@types/vscode` ^1.90.0), tsup, Vitest, `@vscode/vsce`, `ovsx`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-30-vscode-extension-design.md` (read it first; this plan argues from it). Workflow rules: `CLAUDE.md`, one task per turn, stop for review, commit and push straight to `main`.

## Global Constraints

- Package: `apps/vscode`, npm name `nitpilot-vscode`, `"private": true`, display name `Nitpilot`, publisher `nitpilot`, version `0.1.0`, license MIT.
- `engines.vscode`: `^1.90.0`; `@types/vscode` pinned to `~1.90.0` so the code can't use newer API by accident.
- Activation: `onStartupFinished` only.
- Output: one CommonJS file `dist/extension.cjs`; `vscode` external; `nitpilot` (the CLI workspace), `@nitpilot/protocol` and `zod` bundled.
- Server and token come only from the CLI's `loadConfig()`; the extension never writes `config.json` and never prints or logs the token. No extension settings in v1.
- Poll: every `POLL_INTERVAL_MS = 30_000` while the window is focused; immediately on start, on focus, after Refresh and after Retry; never two at once; `me()` and `myChats()` in parallel with `POLL_TIMEOUT_MS = 10_000` each.
- "Need you" = `attention !== 'none'`, over all chats, exactly as `nitpilot status --line`.
- NEEDS words (same as the CLI): `decision` → `a decision`, `manual_review` → `start review`, `failed` → `agent failed`, `drafts` → `drafts`.
- Codicons: `decision` → `question`, `manual_review` → `eye`, `failed` → `error`, `drafts` → `edit`, `none` → `git-pull-request`.
- Status bar texts and backgrounds: exactly the table in the spec's "Status bar" section.
- Release tag `vscode-vX.Y.Z`, must equal `version` in `apps/vscode/package.json`. Trusted publishing for both stores (`id-token: write`); `OVSX_PAT` only for Open VSX's first upload.
- Don't touch `.github/workflows/release.yml` or `scripts/check-release-version.mjs` (the CLI/server release stays as is).

## Review Focus

1. **Token revoked or logged out while the sidebar shows PRs**: the next poll must clear the list, not keep showing the old one as stale. (Test in Task 2: `logged_out` with a `lastGood` shows no rows.)
2. **Server address changed** (`NITPILOT_SERVER` or `nitpilot login` against another server): an old list from the other server must never be shown as stale data. (Test in Task 2: `lastGood.server !== poll.server` → ignored.)
3. **Logged in after VS Code started**: the next poll must pick up the new token without a reload. (Test in Task 1: config is re-read on every `poll()` call.)
4. **Window in the background for hours, then focused**: one poll, not a burst. (Test in Task 1: `singleFlight` returns the in-flight promise to overlapping callers.)
5. **The server's GitHub check fails with no list yet** (needs_reauth on first poll): a clear "sign in again" welcome, never "log in". (Test in Task 1: `me` 200 needs_reauth + chats 401 → `needs_reauth`, `chats: null`.)

---

### Task 1: Package skeleton and `poll.ts`

Also updates the main spec in this first commit (CLAUDE.md: spec and code change together).

**Files:**
- Create: `apps/vscode/package.json`, `apps/vscode/tsconfig.json`, `apps/vscode/tsup.config.ts`, `apps/vscode/vitest.config.ts`, `apps/vscode/src/poll.ts`
- Test: `apps/vscode/src/poll.test.ts`
- Modify: `docs/superpowers/specs/2026-10-07-nitpilot-design.md` §16 (add a "**VS Code (after Plan 3):**" paragraph: status bar + sidebar, polls the CLI's API with the device token, links to the web app for decisions; design doc path) and §21 (the `vscode` docs page and `docs/why/vscode-extensions.md`)
- Modify: `package-lock.json` (from `npm install`)

**Interfaces:**
- Consumes: `loadConfig({ env })` from `nitpilot/src/config/config`; `ServerClient`, `ServerError` from `nitpilot/src/http`; `MyChat` from `@nitpilot/protocol`.
- Produces:
  ```ts
  export const POLL_INTERVAL_MS = 30_000;
  export const POLL_TIMEOUT_MS = 10_000;
  export type Poll =
    | { state: 'ok'; server: string; chats: MyChat[] }
    | { state: 'needs_reauth'; server: string; chats: MyChat[] | null }
    | { state: 'logged_out'; server: string | null }
    | { state: 'unreachable'; server: string; message: string }
    | { state: 'error'; server: string | null; message: string };
  export type PollDeps = { env?: Record<string, string | undefined>; fetch?: typeof fetch };
  export function poll(deps?: PollDeps): Promise<Poll>;
  export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T>;
  ```

- [x] **Step 1: Create the package files**

  `package.json`: name/private/version/displayName/publisher/license per Global Constraints, `"type": "module"`, `"main": "./dist/extension.cjs"`, `engines.vscode`, `activationEvents: ["onStartupFinished"]`, `repository` (`directory: "apps/vscode"`), `homepage: "https://nitpilot.dev/docs/vscode"`, scripts `build` (`tsup`), `test` (`vitest run`), `typecheck` (`tsc -p tsconfig.json`), `vscode:prepublish` (`npm run build`), `package` (`vsce package --no-dependencies -o dist/nitpilot.vsix`). devDependencies: `nitpilot: "*"`, `@nitpilot/protocol: "*"`, `zod` (same range as the CLI), `@types/vscode: "~1.90.0"`, `tsup` (same range as the CLI), `@vscode/vsce`, `ovsx` (latest at build time, caret). Leave `contributes` empty here; Task 3 fills it.
  `tsconfig.json`: like the CLI's (`extends ../../tsconfig.base.json`, include `src`, `tsup.config.ts`, `vitest.config.ts`).
  `tsup.config.ts`: entry `src/extension.ts`, format `cjs`, platform `node`, target `node20`, `external: ['vscode']`, `noExternal: ['nitpilot', '@nitpilot/protocol', 'zod']`, clean.
  `vitest.config.ts`: include `src/**/*.test.ts`.
  Run `npm install` at the repo root.

- [x] **Step 2: Write the failing tests** in `src/poll.test.ts`

  Each test makes a temp dir, writes `config.json` (`{ "server": "https://np.test", "token": "<BRAND.tokenPrefix>abc" }` unless stated), passes `env: { NITPILOT_CONFIG_DIR: dir }` and a fake `fetch` routing on URL path (`/api/me`, `/api/me/chats`).
  - `ok`: me 200 `{ login, avatarUrl: null, githubAuth: 'ok' }`, chats 200 with two chats → `{ state: 'ok', server: 'https://np.test', chats }`.
  - `no token`: config without token → `{ state: 'logged_out', server: 'https://np.test' }` and fetch was never called.
  - `revoked`: me 401 → `logged_out`.
  - `needs_reauth, chats fail`: me 200 `githubAuth: 'needs_reauth'`, chats 401 `{ error: { code: 'reauth', message: '…' } }` → `{ state: 'needs_reauth', chats: null }`.
  - `needs_reauth, chats ok`: → `{ state: 'needs_reauth', chats: [...] }`.
  - `network`: fetch throws → `unreachable`, message contains `Can't reach https://np.test`.
  - `5xx and 502`: chats 503 and chats 502 `github_unavailable` → `unreachable`.
  - `schema mismatch`: chats 200 `{ chats: [{ ...chat, attention: 'brand_new' }] }` → `error`, message ends with `Update the Nitpilot extension, or check the server's version.`
  - `broken config`: `config.json` is `{` → `error` with `server: null`, message names the file path.
  - `re-reads config` (Review Focus 3): first call with no token → `logged_out`; write a token; second call → `ok`.
  - `timeout`: a fetch that never resolves until aborted → `unreachable` (use fake timers or pass the signal through; assert the request got an `AbortSignal`).
  - `singleFlight` (Review Focus 4): two calls while the first is pending return the same promise and `fn` ran once; a call after it settles runs `fn` again; a rejection also clears it.

- [x] **Step 3: Run them, expect failures**

  Run: `npm test -w apps/vscode`. Expected: FAIL, `poll` not found.

- [x] **Step 4: Implement `poll()` and `singleFlight()`**

  `loadConfig` in a try (throw → `error`, `server: null`). `token === null` → `logged_out` before any request. Then `Promise.allSettled([client.me({ signal }), client.myChats({ signal })])` with `AbortSignal.timeout(POLL_TIMEOUT_MS)` for each. Decide in this order: me rejected with `ServerError` 401 → `logged_out`; me fulfilled with `needs_reauth` → `needs_reauth` (chats or `null`); any rejection with `status === 0 || status >= 500` → `unreachable`; any rejection with `status` 200–299 (schema) → `error` with the suffix above; other rejection → `error` with its message; else `ok`. Comment the shortcut from the spec on `POLL_INTERVAL_MS`: `// shortcut: polling (30 s, focused windows only); a live "my chats changed" stream on a token-authed socket if users ask for instant updates.`

- [x] **Step 5: Run the tests, typecheck and lint**

  Run: `npm test -w apps/vscode && npm run typecheck -w apps/vscode && npx eslint apps/vscode`. Expected: all pass, no errors.

- [x] **Step 6: Update the main spec (§16, §21) as listed under Files.**

**Built (2026-10-30):** `PollDeps` also takes `timeoutMs` (Vitest's fake timers don't drive `AbortSignal.timeout`, so the timeout test passes 20 ms). Dev deps resolved to `@vscode/vsce` ^4.1.0 and `ovsx` ^1.3.0. npm 11 skipped the install scripts of esbuild and `@vscode/vsce-sign`; tsup still bundles (checked), packaging is checked in Task 4.

- [x] **Step 7: Commit and push**

  ```bash
  git add apps/vscode package-lock.json docs/superpowers/specs/2026-10-07-nitpilot-design.md
  git commit -m "feat(vscode): extension package and server poll"
  git push origin main
  ```

---

### Task 2: `view-model.ts`

**Files:**
- Create: `apps/vscode/src/view-model.ts`
- Test: `apps/vscode/src/view-model.test.ts`

**Interfaces:**
- Consumes: `Poll` (Task 1); `MyChat`, `Attention`, `RetryResponse` from `@nitpilot/protocol`; `prUrl` from `nitpilot/src/commands/status`.
- Produces:
  ```ts
  export type LastGood = { server: string; chats: MyChat[]; at: Date };
  export type StatusBarModel = { text: string; tooltip: string; warning: boolean; command: 'nitpilot.showPrs' | 'nitpilot.login' | 'nitpilot.openServer' };
  export type ChatRow = { chat: MyChat; label: string; description: string; tooltip: string; icon: string; contextValue: 'chat' | 'chat.failed'; githubUrl: string };
  export type Group = { id: 'needs' | 'open'; label: string; rows: ChatRow[] };
  export type TreeModel = { reauthRow: boolean; groups: Group[]; message: string | undefined };
  export function needYouCount(chats: MyChat[]): number;
  export function statusBar(p: Poll): StatusBarModel;
  export function tree(p: Poll, lastGood: LastGood | null): TreeModel;
  export function nextLastGood(p: Poll, prev: LastGood | null, now: Date): LastGood | null;
  export function retryMessage(chat: Pick<MyChat, 'repo' | 'number'>, status: RetryResponse['status']): string;
  ```

- [x] **Step 1: Write the failing tests** in `src/view-model.test.ts`

  - `needYouCount`: four chats with attentions `none, decision, failed, none` → `2`.
  - `statusBar` for each spec row: ok with 2 needing you of 5 → `{ text: '$(bell-dot) 2 need you', warning: true, command: 'nitpilot.showPrs' }` and tooltip `2 PRs need you · 5 open on np.test`; ok with 1 → `'$(bell-dot) 1 needs you'`; ok, none needing → `'$(check) 5 open'`, `warning: false`; ok, empty → `'$(check) Nitpilot'`; `logged_out` → `'$(account) Nitpilot: log in'`, command `nitpilot.login`; `unreachable` → `'$(cloud-offline) Nitpilot'`, tooltip is the message; `needs_reauth` → `'$(warning) Nitpilot: sign in again'`, `warning: true`, command `nitpilot.openServer`; `error` → `'$(warning) Nitpilot'`, `warning: false`, tooltip is the message.
  - `tree` grouping: the four chats above → groups `[{ id: 'needs', label: 'Needs you (2)' }, { id: 'open', label: 'Open (2)' }]`, server order kept; an empty group is left out.
  - `ChatRow`: `{ repo: 'acme/web', number: 88, title: 'Add dark mode', attention: 'failed', phase: 'reviewing', round: 2, role: 'author' }` → `label: 'acme/web#88'`, `description: 'Add dark mode · agent failed'`, `icon: 'error'`, `contextValue: 'chat.failed'`, `githubUrl: 'https://github.com/acme/web/pull/88'`; an Open row's description is `'<title> · reviewing · round 2'`; tooltip contains the full title, `author`, the phase and the round.
  - Stale (`unreachable` with `lastGood` from the same server at 14:02) → the old groups, `message` contains `as of 14:02`.
  - Review Focus 1: `logged_out` with a `lastGood` → `groups: []`, `reauthRow: false`.
  - Review Focus 2: `unreachable` on `https://other.test` with `lastGood.server === 'https://np.test'` → `groups: []`.
  - `needs_reauth` with `chats: null` and no lastGood → `reauthRow: false, groups: []` (the welcome view covers it); with chats → `reauthRow: true` plus groups.
  - `error` → `groups: []`, `message` is the poll's message.
  - `nextLastGood`: `ok` (and `needs_reauth` with chats) replace it; `unreachable` keeps the previous; `logged_out` and `error` return `null`.
  - `retryMessage`: `queued` → `Queued your agent again on acme/web#88.`; `waiting` → `Cleared the failure on acme/web#88. Your agent runs again once the PR's current step is done.`

- [x] **Step 2: Run them, expect failures**

  Run: `npm test -w apps/vscode`. Expected: FAIL, module not found.

- [x] **Step 3: Implement `view-model.ts`** to the interfaces above. No `vscode` import. Format "as of" with `toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`; the test builds its expected string the same way so it passes in any locale.

- [x] **Step 4: Run tests, typecheck, lint**

  Run: `npm test -w apps/vscode && npm run typecheck -w apps/vscode && npx eslint apps/vscode`. Expected: pass.

**Built (2026-10-30):** the NEEDS words come from the CLI (`NEEDS` in `apps/cli/src/commands/status.ts`, now exported) so the sidebar and `nitpilot status` can't drift. `needs_reauth` with no list but a `lastGood` from the same server shows that list, stale, under the sign-in-again row (spec: "Errors").

- [x] **Step 5: Commit and push**

  ```bash
  git add apps/vscode/src/view-model.ts apps/vscode/src/view-model.test.ts apps/cli/src/commands/status.ts
  git commit -m "feat(vscode): status bar and sidebar view model"
  git push origin main
  ```

---

### Task 3: The extension (VS Code wiring) and its explainer

**Files:**
- Create: `apps/vscode/src/extension.ts`, `apps/vscode/media/nitpilot.svg` (single-color activity-bar icon from `apps/web/public/icons/icon.svg`, `fill="currentColor"`), `docs/why/vscode-extensions.md`
- Modify: `apps/vscode/package.json` (`contributes`)

**Interfaces:**
- Consumes: `poll`, `singleFlight`, `POLL_INTERVAL_MS`, `Poll` (Task 1); `statusBar`, `tree`, `nextLastGood`, `retryMessage`, `ChatRow`, `LastGood` (Task 2); `loadConfig`, `ServerClient` (CLI) for retry.
- Produces: `export function activate(context: vscode.ExtensionContext): void` and `export function deactivate(): void`.

- [x] **Step 1: Fill `contributes` in `package.json`**

  - `viewsContainers.activitybar`: `{ id: 'nitpilot', title: 'Nitpilot', icon: 'media/nitpilot.svg' }`.
  - `views.nitpilot`: `{ id: 'nitpilot.prs', name: 'Pull requests' }`.
  - `commands` (category `Nitpilot`): `nitpilot.refresh` (Refresh, icon `$(refresh)`), `nitpilot.login` (Log in), `nitpilot.showPrs` (Show PRs), `nitpilot.openServer` (Open Nitpilot), `nitpilot.openChat` (Open chat on Nitpilot), `nitpilot.openGithub` (Open PR on GitHub), `nitpilot.retry` (Retry agent).
  - `menus`: `view/title` → refresh, `when: view == nitpilot.prs`, group `navigation`; `view/item/context` → openChat and openGithub `when: viewItem =~ /^chat/`, retry `when: viewItem == chat.failed`; `commandPalette` hides openChat, openGithub and retry (`when: false`).
  - `viewsWelcome` for `nitpilot.prs`, keyed on the context key `nitpilot.state` (set by the extension to the poll's state, or `empty` for `ok` with no chats):
    - `logged_out`: "Sign in to Nitpilot to see your PRs here.\n[Log in](command:nitpilot.login)\nNeeds the nitpilot CLI: `npm install -g nitpilot`."
    - `empty`: "No open PRs with Nitpilot yet. When a PR opens on a repo with Nitpilot, it shows up here.\n[Quickstart](https://nitpilot.dev/docs/quickstart)"
    - `needs_reauth`: "Your GitHub sign-in expired. Sign in again on Nitpilot to see your PRs.\n[Sign in again](command:nitpilot.openServer)"
    - `unreachable`: "Can't reach the Nitpilot server. Trying again every 30 seconds.\n[Retry now](command:nitpilot.refresh)"
    - `error`: "Something's wrong with Nitpilot's setup. The message above says what.\n[Retry now](command:nitpilot.refresh)"

- [x] **Step 2: Write `extension.ts`**

  - A `StatusBarItem` (`Left`, priority `-100`); after each poll set text/tooltip/command from `statusBar()`, and `backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')` when `warning`.
  - A `TreeDataProvider` over `tree(poll, lastGood)`: top level is the reauth row (if `reauthRow`; clicking runs `nitpilot.openServer`), then a `TreeItem` per group (`Expanded`), then `ChatRow`s (`iconPath: new vscode.ThemeIcon(row.icon)`, `contextValue`, `tooltip`, `description`, and `command: nitpilot.openChat` with the row). `createTreeView('nitpilot.prs', …)`; set `treeView.message = model.message`.
  - `refresh = singleFlight(async () => { … })`: run `poll()`, update `lastGood = nextLastGood(…)`, set context `nitpilot.state`, fire `onDidChangeTreeData`, update the status bar; append one line to the "Nitpilot" output channel only when the state changes (state name and message, never the token).
  - Timer: `setInterval(() => { if (vscode.window.state.focused) void refresh(); }, POLL_INTERVAL_MS)`; `onDidChangeWindowState(s => s.focused && refresh())`; `refresh()` on activate. Dispose all through `context.subscriptions`.
  - Commands: `openChat` / `openGithub` → `vscode.env.openExternal(vscode.Uri.parse(url))`; `openServer` → the server from the last poll (or `loadConfig().server`); `showPrs` → `workbench.view.extension.nitpilot`; `login` → reuse or create a terminal named `Nitpilot`, `show()`, `sendText('nitpilot login')`; `retry` → status bar `$(sync~spin) Retrying…`, `new ServerClient(cfg.server, cfg.token).retry(row.chat.id)`, then `setStatusBarMessage(retryMessage(...), 5000)` and `refresh()`; on error `showErrorMessage(err.message)` and `refresh()`.

- [x] **Step 3: Build, typecheck, lint**

  Run: `npm run build -w apps/vscode && npm run typecheck -w apps/vscode && npx eslint apps/vscode`. Expected: `dist/extension.cjs` exists, no errors.

- [x] **Step 4: Hand-test in an Extension Development Host**

  Run: `code --extensionDevelopmentPath="$PWD/apps/vscode"` (the developer's real login on nitpilot.dev). Check, and write each result in the task report:
  1. Status bar shows the right count within a few seconds of the window opening; clicking it opens the sidebar.
  2. Sidebar groups and rows match `nitpilot status` in a terminal (same PRs, same NEEDS words).
  3. Clicking a row opens its chat; right-click → Open PR on GitHub opens the PR.
  4. Retry agent appears only on a failed row (if none is failed, say so; the unit tests cover the message).
  5. Log out state: relaunch with `NITPILOT_CONFIG_DIR=$(mktemp -d) code --extensionDevelopmentPath=…`, so the window starts with no token. Expect "Nitpilot: log in" and the welcome view. **Log in** opens a terminal running `nitpilot login`.
  6. Unreachable: relaunch with `NITPILOT_SERVER=http://localhost:9` → offline icon, welcome text, Retry now works.
  7. Window unfocused for over a minute → the Output channel shows no polling noise; focus → one refresh.
  8. Corporate proxy (spec risk): if no proxy is available, write "not checked".

**Hand test (2026-10-30)**, VS Code 1.143.1, in a test window against a throwaway stub API (the local logins were revoked and the nitpilot.dev login has no open PRs), checked through the Nitpilot Output log and by the user:
1. Status bar showed `4 need you` (the stub had four PRs needing you), and clicking it opened the sidebar. Pass.
2. The sidebar showed Needs you (4) and Open (2). Pass.
3. Clicking a row opened that chat's link. Pass. Open PR on GitHub wasn't clicked.
4. Retry agent wasn't clicked by hand; its wording is covered by the unit tests.
5. Logged out: the window was unfocused while I removed the token, so no poll ran. That matches the design. Not seen in the UI.
6. Unreachable: stopping the stub gave `unreachable: Can't reach http://localhost:8799: fetch failed` on the next poll. Pass.
7. Each time the window got focus back from the browser, it polled at once. Pass.
8. Proxy: not checked.
Extra: zod's check for a `navigator` object makes VS Code log a harmless deprecation warning at startup. The bundle is minified (~470 KB, almost all zod).

- [x] **Step 5: Write `docs/why/vscode-extensions.md`**

  Plain-language, React terms, as listed in the spec's Docs section: `contributes` is a static manifest like a route table; `activate()` is `main.tsx`; a TreeDataProvider's `getChildren` is its render and `onDidChangeTreeData` is `setState`; context keys and `when` clauses are like conditional rendering from global state; and why polling (link to `docs/why/websockets.md`). Point to `apps/vscode/src/extension.ts`.

- [x] **Step 6: Commit and push**

  ```bash
  git add apps/vscode docs/why/vscode-extensions.md
  git commit -m "feat(vscode): status bar, sidebar, retry and log in"
  git push origin main
  ```

---

### Task 4: Package listing, CI packaging and the docs page

**Files:**
- Create: `apps/vscode/README.md` (the Marketplace page), `apps/vscode/CHANGELOG.md` (`## 0.1.0`), `apps/vscode/LICENSE` (copy of `apps/cli/LICENSE`), `apps/vscode/.vscodeignore`, `apps/vscode/media/icon.png`, `apps/web/src/routes/Docs/pages/vscode.md`
- Modify: `apps/vscode/package.json` (`icon: "media/icon.png"`, `galleryBanner`, `categories: ["Other"]`, `keywords: ["code-review", "pull-request", "github", "ai", "nitpilot"]`), `apps/web/src/routes/Docs/pages.ts`, `.github/workflows/ci.yml`

- [x] **Step 1: Icon.** Run `sips -Z 128 apps/web/public/icons/icon-512.png --out apps/vscode/media/icon.png`. Expected: a 128×128 PNG.

- [x] **Step 2: `.vscodeignore`**: ignore everything (`**`), then un-ignore `dist/extension.cjs`, `media/**`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`.

- [x] **Step 3: README and docs page.** `apps/web/src/routes/Docs/pages/vscode.md`, "Use Nitpilot in VS Code", in the style of `claude-code.md`: install (Marketplace and Open VSX links: `https://marketplace.visualstudio.com/items?itemName=nitpilot.nitpilot-vscode`, `https://open-vsx.org/extension/nitpilot/nitpilot-vscode`), needs `nitpilot login` (any CLI version), the status bar states, the sidebar and its right-click menu, retry, "checks every 30 seconds while the window is focused", and one troubleshooting line for proxies (from Task 3's result). Add `{ slug: 'vscode', title: 'Use Nitpilot in VS Code', group: 'Guides' }` right after `claude-code` in `pages.ts`. `apps/vscode/README.md` is the same content with absolute links to nitpilot.dev and a screenshot placeholder removed (no image until there's a real screenshot).

- [x] **Step 4: Package locally**

  Run: `npm run package -w apps/vscode && unzip -l apps/vscode/dist/nitpilot.vsix`. Expected: the list holds `extension/dist/extension.cjs`, `extension/media/…`, README, CHANGELOG, LICENSE, `package.json`, and no `node_modules` or `src`. Install it in your normal VS Code ("Extensions: Install from VSIX…") and confirm the status bar item appears.

- [x] **Step 5: CI.** In `.github/workflows/ci.yml`, after the CLI's `npm publish --dry-run` step, add:
  ```yaml
      # The VS Code extension as the Marketplace would get it: a broken manifest fails here, not at release.
      - run: npm run package -w apps/vscode
  ```

- [x] **Step 6: Run everything the CI runs that this touches**

  Run: `npm run typecheck && npm run lint && npm test -w apps/vscode && npm test -w apps/web && npm run build`. Expected: pass (the web build includes the new docs page).

**Built (2026-10-30):** the `.vsix` is 108 KB with 9 files (no `node_modules`, no `src`). npm skipping `@vscode/vsce-sign`'s install script didn't matter for `vsce package`. Instead of the user's own VS Code, it was installed into a throwaway profile (`code --extensions-dir … --install-extension`), which listed `nitpilot.nitpilot-vscode@0.1.0`. The docs page was checked in the browser.

- [x] **Step 7: Commit and push**

  ```bash
  git add apps/vscode apps/web/src/routes/Docs .github/workflows/ci.yml
  git commit -m "feat(vscode): listing, packaging in CI, docs page"
  git push origin main
  ```

---

### Task 5: Release workflow and release docs

**Files:**
- Create: `.github/workflows/release-vscode.yml`
- Modify: `docs/releasing.md` (new section "Releasing the VS Code extension"), `docs/why/releasing.md` (one paragraph: why the extension has its own version and tag)

- [x] **Step 1: Write `release-vscode.yml`**

  Trigger `push: tags: ['vscode-v*']`; top-level `permissions: {}`; one job, `permissions: contents: write` (for the GitHub release), Node 22, `npm ci`, then:
  ```yaml
      # The tag must match the extension's version, or nothing is published.
      - run: test "$(node -p "require('./apps/vscode/package.json').version")" = "${GITHUB_REF_NAME#vscode-v}"
      - run: npm run package -w apps/vscode
      - run: npx vsce publish --packagePath dist/nitpilot.vsix
        working-directory: apps/vscode
        env: { VSCE_PAT: '${{ secrets.VSCE_PAT }}' }
      - run: npx ovsx publish dist/nitpilot.vsix
        working-directory: apps/vscode
        env: { OVSX_PAT: '${{ secrets.OVSX_PAT }}' }
      - run: gh release create "$GITHUB_REF_NAME" apps/vscode/dist/nitpilot.vsix --title "VS Code extension ${GITHUB_REF_NAME#vscode-v}" --notes "See apps/vscode/CHANGELOG.md."
        env: { GH_TOKEN: '${{ github.token }}' }
  ```
  Use block-style `env:` mappings in the real file; the inline form above only keeps the plan short.

- [x] **Step 2: Check the YAML parses.** Run: `ruby -ryaml -e 'YAML.load_file(ARGV[0])' .github/workflows/release-vscode.yml`. Expected: no output. (The real test is the first release; the tag check is its first step, so a mistake fails before anything is published.)

- [x] **Step 3: `docs/releasing.md`.** Add the section: the tag (`vscode-vX.Y.Z`), the one place the version lives (`apps/vscode/package.json`, plus `apps/vscode/CHANGELOG.md` and the docs changelog page), try the `.vsix` locally first (Task 4 Step 4), what the workflow does, and the one-way door: a Marketplace version can't be published twice, so a mistake means a new patch version. Then the one-time setup (Step 4's clicks, written for the reader).

**Built (2026-10-30), changed from the steps above:** the Visual Studio Marketplace and Open VSX both support trusted publishing from GitHub Actions now (Marketplace personal access tokens are retired on 2026-12-01). So the workflow asks for `id-token: write` and runs `vsce publish --oidc`, and there is no `VSCE_PAT`. Open VSX trusts a workflow only once the extension exists there, so `OVSX_PAT` is used for the first upload only; with no secret, `ovsx` switches to trusted publishing by itself (checked in `node_modules/ovsx/lib/publish.js`). Both publish steps add `--skip-duplicate` so a re-run is safe. Step 5's clicks below are replaced by the "One-time setup" section in `docs/releasing.md`.

- [x] **Step 4: Commit and push**

  ```bash
  git add .github/workflows/release-vscode.yml docs/releasing.md docs/why/releasing.md
  git commit -m "ci(vscode): release workflow for vscode-v tags"
  git push origin main
  ```

- [ ] **Step 5: One-time accounts (the user does these; give the clicks in chat, one account at a time, and check the current docs if a screen differs)**

  VS Code Marketplace, signed in with the Microsoft account the user wants to own the listing:
  1. Open https://marketplace.visualstudio.com/manage → **Create publisher** → ID `nitpilot`, name `Nitpilot` → **Create**.
  2. Open https://dev.azure.com (same Microsoft account; create an organization if asked, any name) → user settings icon (top right) → **Personal access tokens** → **New Token** → Organization **All accessible organizations**, Expiration the longest offered, Scopes **Custom defined** → **Show all scopes** → **Marketplace: Manage** → **Create**. Copy the token.
  3. GitHub, signed in as `NikosGkikas13`: repo `nitpilot` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** → name `VSCE_PAT`, paste → **Add secret**.

  Open VSX:
  1. Create an Eclipse account at https://accounts.eclipse.org/user/register (use the same GitHub username in the profile's GitHub field).
  2. Open https://open-vsx.org → **Log in** (with GitHub `NikosGkikas13`) → avatar → **Settings** → **Log in with Eclipse** → sign the **Publisher Agreement**.
  3. Same page → **Access Tokens** → **Generate New Token** (description `nitpilot release`) → copy it.
  4. In a terminal: `npx ovsx create-namespace nitpilot -p <token>`.
  5. GitHub secret `OVSX_PAT` as above.

- [ ] **Step 6: First release (only with the user's go-ahead in chat: publishing can't be undone)**

  Add the `v0.1.0` VS Code entry to `apps/web/src/routes/Docs/pages/changelog.md` and commit it. Then:
  ```bash
  git tag vscode-v0.1.0
  git push origin vscode-v0.1.0
  ```
  Watch the **Release VS Code extension** run on GitHub Actions. Expected: green; the extension on both listing pages from Task 4 Step 3 within a few minutes (Marketplace can take up to ~10 min to verify); the `.vsix` attached to the GitHub release. Install from the Marketplace in a clean VS Code profile and repeat Task 3's checks 1–3.
