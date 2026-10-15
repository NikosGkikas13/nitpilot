# The transcript page: who may see a chat, and what it's waiting on

**In one sentence:** `/c/<owner>/<repo>/<number>` shows one chat to anyone signed in to Nitpilot whose GitHub account can read the repo, with a line saying what the chat is waiting on right now (spec §10, §16).

## Who may see it (`auth/repo-access.ts`)

The summary comment on GitHub links here, so anyone could click it. A chat repeats code and review points from the repo, so only people who can read the repo on GitHub may see it:

1. Not signed in → off to GitHub sign-in, and back to this page after (`?next=`).
2. Signed in → Nitpilot asks GitHub `GET /repos/<owner>/<repo>` **with your own token**. GitHub answers 404 for a private repo you can't read, so a 404 (or a 403) means no.
3. The answer is kept for 5 minutes per person and repo, so reading a chat doesn't call GitHub every time. The cost: someone removed from a repo can still see its chats for up to 5 minutes.

`http/routes/inbox.ts` is a second place that uses the same `RepoAccess`: the inbox shows each PR's title and newest message, so it asks about each repo once and leaves out the rows of repos you can no longer read.

"No such chat" and "you can't see it" get the **same** 404 page. Otherwise someone could try URLs and learn which private repos have chats. If your GitHub sign-in expired, the page asks you to sign in again instead.

To keep those two answers identical for everyone, Nitpilot asks GitHub about the repo in the URL **before** it looks for the chat. Otherwise someone whose sign-in expired would get "sign in again" for a chat that exists and a 404 for one that doesn't, and could use that to find out which private chats exist. The cost: a made-up URL costs one GitHub call, with your own token, and the answer is kept for 5 minutes. Owner and repo names that aren't shaped like GitHub's (letters, digits, `-`, `_`, `.`) are turned away before any call, since they go into a GitHub API path.

## What it's waiting on (`chats/activity.ts`)

"leo's agent is waiting: offline since 09:30" is never stored. It's **derived** each time the page is shown, from the chat's queued and running jobs and the CLIs connected right then. Storing it would mean updating it whenever a laptop goes to sleep, which no event tells us about. `deriveActivity` is a pure function (facts in, status out), so every case has a plain table test; `loadActivity` gathers the facts from the database and the CLI hub.

## Two safety details

- **Escaping.** Point titles, bodies and replies come from agents and PR authors, so they may contain HTML. JSX escapes text, so `<script>` shows up as text and never runs.
- **Clickjacking.** Another site could load one of our pages in an invisible frame and trick you into clicking a button on it, such as "Approve" on the CLI approval page. Every server page sends `Content-Security-Policy: frame-ancestors 'none'` (`http/pages/layout.tsx`), which tells browsers not to show it inside another site.

## The React analogy

Activity is derived state, like a value you compute from props in render instead of copying it into `useState`: there's nothing to keep in sync, because it's worked out from the source of truth every time.
