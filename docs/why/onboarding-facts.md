# Onboarding facts (the setup checklist that ticks itself off)

**In one sentence:** the `/setup` page never asks you to tick anything; it asks the server what is already true (is the app installed, has a computer logged in, has it linked a repo, has it found an agent), and asks again whenever something about you may have changed.

## Where each tick comes from

`GET /api/onboarding` (`http/routes/onboarding.ts`) answers four facts, worked out in `auth/onboarding.ts`:

| Step | True when | Where that's stored |
|---|---|---|
| 1. Sign in with GitHub | always: only a signed-in person can ask | (nothing) |
| 2. Install the GitHub App | GitHub lists an installation of this app you can see | GitHub, `GET /user/installations` with your own token |
| 3. Connect your computer | you have a CLI token nobody revoked | `CliToken` rows (`npx nitpilot login` makes one) |
| 4. Link a repo | one of those tokens' last hello reported a linked repo | `CliToken.repos` |
| 5. Start your agent | one of them reported an agent that can run | `CliToken.agentId` |

Steps 4 and 5 come from the "hello" `nitpilot start` sends when it connects: the hub saves the repos and the agent on the token (`ws/cli-hub.ts`, `rememberHello`, docs/why/revoking-devices.md).

## How the page hears about a change

Think of `['onboarding']` as an ordinary TanStack Query. Two things make it fetch again:

- **The server says "something about you changed".** On `/ws/web` it sends `me.update` when one of your CLIs connects or disconnects, and when `nitpilot login`'s first poll after you approved it makes the token (`http/routes/cli.ts` passes a hook to `pollCliLogin`). The web app's handler (`live/apply.ts`) calls `invalidateQueries(['onboarding'])`, so the list moves without a reload. It's like a server-triggered refetch.
- **The window comes back into view.** Installing the app happens on GitHub, in another tab, and GitHub doesn't tell our browser tab anything. TanStack already refetches a query when the window regains focus (its `refetchOnWindowFocus` default, with no `staleTime`), so coming back from GitHub's tab is enough. GitHub also sends you to `/github/setup` after an install, which now redirects to `/setup`.

## Why GitHub's "yes" is kept but its "no" isn't

Asking GitHub can take a while (up to 15 seconds before we give up), and the page asks on every focus. So a **yes** is kept for 5 minutes per person, in a small in-memory cache like the one for repo access (`lib/ttl-cache.ts`). An app rarely gets uninstalled in the middle of setting up.

A **no** is never kept: the moment you come back from installing, the next read must ask GitHub again and see the fresh install. Caching "no" would leave the step unticked for 5 minutes right when you're watching it.

If GitHub fails, times out, or your GitHub sign-in needs renewing, the step just reads "not yet" (and the server logs why). The checklist is a guide, not a gate, so it never shows an error for that.

## Why "done" is stored

Once all four facts hold at the same time, the server writes `User.onboardedAt` (only if it's still empty, so two reads at once write it once). From then on:

- the checklist reads every step as done without asking GitHub at all;
- revoking a computer later doesn't "un-finish" your setup;
- a sign-in goes straight to the inbox instead of `/setup` (`http/routes/auth.ts`), and Settings stops showing its "Finish setting up" card (`WebMe.onboarded`).

Without storing it, someone who swapped laptops would be sent back through onboarding, and every read would cost a GitHub call forever.
