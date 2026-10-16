# Who can see a chat

**In one sentence:** anyone signed in to Nitpilot whose GitHub account can read the repo can read its chats; Nitpilot asks GitHub with that person's own token, keeps the answer 5 minutes, and answers "no such chat" and "you can't see it" the same way (spec §16).

## Why GitHub decides

A chat repeats code, file paths and review points from the repo. For a private repo that's private code, so the rule is GitHub's own: if GitHub shows you the repo, you may read its chats. Nitpilot doesn't keep its own list of who may see what. It asks GitHub `GET /repos/<owner>/<repo>` **with your token** (`auth/repo-access.ts`). GitHub answers 404 for a private repo you can't read, so a 404 (or a 403) means no.

Asking with the app's token instead would be wrong: the app can read every repo it's installed on, and that says nothing about you.

## Where it's checked

The same question, everywhere a chat is read:

- `GET /api/chats/:owner/:repo/:number`, `…/:id/messages` and `…/:id/files` (`http/routes/chats.ts`);
- each `chat.subscribe` on `/ws/web`, and again before sending once the answer is 5 minutes old (`ws/web-hub.ts`);
- each row of your inbox, once per repo (`http/routes/inbox.ts`).

`chats/access.ts` puts the lookup and the question together: `chatAccess` for a chat id, `chatAccessByPath` for the address in the browser.

## The answers

| Situation | REST | `/ws/web` |
|---|---|---|
| You can read the repo | the chat | its items |
| No such chat, or you can't see its repo | 404 `not_found` | `chat.error not_found` |
| Your GitHub sign-in expired | 401 `reauth` ("Sign in with GitHub again…") | `chat.error reauth` |
| GitHub didn't answer | 502 `github_unavailable` | `chat.error unavailable` |
| Not signed in to Nitpilot | 401 `unauthorized` | no socket (401) |

**Why one 404 for two cases.** If "no such chat" and "you can't see it" looked different, anyone could try addresses and learn which private repos use Nitpilot and how many PRs they have. So both are the same 404, with the same body.

**Why GitHub is asked first, for an address.** `chatAccessByPath` asks about the repo in the address before it looks for the chat. Otherwise someone whose sign-in expired would get "sign in again" for a chat that exists and a 404 for one that doesn't. Owner and repo names that aren't shaped like GitHub's (letters, digits, `-`, `_`, `.`) get the 404 before any call, since they go into a GitHub API path.

**Why 401 `reauth` and not 401 `unauthorized`.** Both are "who are you?", but they mean different things to the web app: `unauthorized` is "you're not signed in to Nitpilot" (show the landing page), `reauth` is "you are, but your GitHub sign-in expired" (show the Reconnect banner).

## What the 5 minutes cost

Asking GitHub on every read would make each chat open wait on GitHub, and spend the person's GitHub rate limit. So the answer is kept 5 minutes per person and repo (`lib/ttl-cache.ts`, at most 1,000 answers). The cost: someone removed from a repo can still read its chats for up to 5 minutes. An open socket asks again when its answer is that old, so it stops too.

## Who can *do* what

Reading is the only thing W3 allows. From W4 every change (a note, Resolve, Continue, Retry, Auto, drafts) also passes one pure function that knows the roles: notes for the author and the reviewers on Nitpilot, Resolve only for the reviewer who raised the point, and so on (spec §16 "Who can act in a chat"). Someone who can read the repo but isn't in the chat reads along, and can't act.

## The React analogy

It's a route guard, like a `<RequireAuth>` wrapper around a page, except the guard asks a second service (GitHub) and caches its answer like a query with a `staleTime` of 5 minutes.
