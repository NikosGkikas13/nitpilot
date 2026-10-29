# Docs site at nitpilot.dev/docs: design

Date: 2026-10-29. Status: draft, waiting for approval.

## Why

The landing page's **Docs** link (`apps/web/src/routes/Landing/Landing.tsx:37`) goes to `github.com/…/tree/main/docs`. That folder mixes user docs with internal material (specs, design handoff, launch drafts, acceptance checklists, the `why/` explainers), so a curious visitor lands in the middle of the project's working files. Nitpilot needs real docs, on its own site, that look like the product.

## Who it's for

Curious developers arriving at nitpilot.dev, often from Show HN. They come for three things, and the site must serve all three:

1. **"I get it."** Within a minute or two they understand the idea: your agent reviews your teammates' PRs, theirs reviews yours, and a person hears about it only when there's a decision to make. A diagram or real example does this better than prose.
2. **"I could set this up."** A quickstart takes them from zero to their first reviewed PR.
3. **"I'm stuck, where's the answer?"** Troubleshooting and reference are easy to find.

The developer wants both understanding (portfolio, impress) and installs.

## Goals

- Public pages under `/docs` on nitpilot.dev (and on every self-hosted server, since it ships with the web app).
- Looks and feels like nitpilot.dev: same tokens (`apps/web/src/styles/tokens.css`), fonts, light/dark theme toggle.
- Every page is a Markdown file in the repo; editing docs means editing a file.
- The landing page's Docs link points at `/docs`.

## Non-goals

- No second site, build tool or domain (no VitePress, Starlight, Docusaurus, no docs.nitpilot.dev).
- No versioned docs, i18n, comments, feedback widgets or analytics.
- Internal material stays out: `hosting.md`, `releasing.md`, `superpowers/`, `design/`, `launch/`, `acceptance/`, `why/`.
- No change to the README. It keeps its full content; the docs hold their own copy of the same material (developer's decision: "keep it").

## Anti-goals (it fails even if it works, if…)

- It looks like a different product from nitpilot.dev.
- A visitor needs to sign in, or the page opens the app's WebSocket, to read docs.
- It bloats the main app bundle for signed-in users (docs must load as their own lazy chunk, like `Approve`/`Setup`/`FirstRun` in `App.tsx`).

## Decided

**Layout: three columns** (developer picked option A from the mockup):

- Top bar: wordmark + "Docs" tag (links to `/docs`), search box with ⌘K / Ctrl-K, then GitHub, Sign in (or Open app when signed in, if cheap to know), theme toggle.
- Left: the page list, grouped. The current page is highlighted.
- Middle: the page. Breadcrumb (group name), title, lede, body. Previous/Next links at the bottom.
- Right: "On this page", the page's `##`/`###` headings, highlighting the one in view.
- On narrow screens the left and right columns collapse: the page list behind a menu button, "On this page" hidden. At phone width, 16px side gutters and no horizontal scroll (code blocks scroll inside themselves).

**Page list** (shown in the mockup; developer did not object):

| Group | Page | Source |
|---|---|---|
| Get started | Introduction | README opening + a diagram: PR opened → nitpilot.dev → your laptop (your agent) → review on GitHub in your name |
| | Quickstart | README "Install" |
| | How it works | README "How it works" + "When your teammate is on it too", simplified |
| Guides | Use GitHub Copilot CLI | README Copilot paragraphs |
| | When your teammate is on it too | README section of that name |
| | Settings & Auto-review | **new**: the web app's Settings (Auto-review, push, devices, agent/model) |
| | Self-hosting | `docs/self-hosting.md` |
| Reference | CLI commands | **new**: `login`, `repos add`, `start`, `status`, `doctor`, `retry` (from `apps/cli/src/commands/`) |
| | config.json | **new**: `~/.config/nitpilot/config.json` fields (`agent`, `model`, …) |
| | Security | README "Security" |
| Help | Troubleshooting | **new**: "nothing happened", `doctor` output, Copilot `auth` failures, offline machine, outside-contributor PRs; plus self-hosting's troubleshooting |
| | Limits & FAQ | README "What to know" |
| | Changelog | **new**: hand-written, one entry per release tag (v0.1.0 … v0.1.2 so far; release candidates left out) |
| Under the hood | Architecture | `docs/architecture.md` |
| | Writing an adapter | `docs/adapters.md` |

**Branch and release:** built on `main` after Copilot support was merged (PR #10) and shipped together with GitHub Copilot CLI support in the next release (v0.1.3), so every page, Copilot ones included, matches what `npm install -g nitpilot` installs. The Changelog's latest entry is v0.1.3 (developer's decision).

**Where it lives:** in the existing web app (`apps/web`) as routes under `/docs`, served by the existing server like every other page (`apps/server/src/http/spa.ts` already returns `index.html` for unknown GETs). It sits outside `<Home>` in `AppRoutes`, like `/cli/approve`: no auth check, no socket.

## Left to the builder (my calls, flagged so the developer can check them)

- **Markdown rendering.** One small, well-known library (e.g. `marked`) at build or run time; imported via Vite (`import.meta.glob` with `?raw`, or a tiny plugin). Content is ours, so rendering it as HTML is fine; no user input reaches it. Code blocks get a Copy button (reuse `useCopy` from `apps/web/src/lib/clipboard.ts`).
- **Where the Markdown files live.** Suggested: `apps/web/src/routes/Docs/pages/<slug>.md`, with the group/order/title list in one small TypeScript file next to them. Links between pages use `/docs/<slug>`.
- **Search.** Client-side, over page titles, headings and text, all bundled in the docs chunk. No index service. A simple substring/word match is enough at ~15 pages.
- **Page titles.** Each page sets `document.title` (`<Page> · Nitpilot docs`). No prerendering; search engines that run JavaScript will see the pages. (shortcut: SPA-only HTML, upgrade to build-time prerender if search traffic matters.)
- **Copy edits.** Material moved from the README and `docs/*.md` is reworded for the site where needed (drop repo-relative links, link to other docs pages instead). The original files stay as they are.
- **Diagram** on Introduction/How it works: inline SVG or HTML/CSS using the tokens, readable in both themes.
- **Unknown slug** under `/docs/…` shows a "Page not found" inside the docs layout, with a link to Introduction.
- **Tests:** a Vitest test that every page in the list has a file and every `/docs/…` link in the Markdown points at a real page; a test that `/docs` renders without signing in. Extend the Playwright smoke test to open `/docs` if that's cheap.
- **Self-hosted servers show the same pages.** Text says "nitpilot.dev" everywhere, as the README does; the Self-hosting page says to use your own server's address instead. No runtime placeholders.
- **Settings & Troubleshooting** are written from the current code (`apps/web/src/routes/Settings/`, `apps/cli/src/commands/doctor.ts`), not from the README's description.
- `.superpowers/` goes into `.gitignore` (brainstorm mockups live there).

## Spec

Update spec §21 (Docs) in the same change: add the docs site, its location, and that the README and the site keep separate copies.
