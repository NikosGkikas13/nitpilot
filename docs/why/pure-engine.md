# Why the engine is a pure function

**In one sentence:** every Nitpilot workflow rule lives in `decide()`, which works like a Redux reducer: it takes the current state and one event and returns the next state, with no I/O.

## The React analogy

In Redux you write `reducer(state, action) → newState` and keep side effects (fetching, storage) out of it, in middleware. Nitpilot does the same:

| Redux | Nitpilot |
|---|---|
| `state` | `ChatState`: the PR chat's phase, participants, points and active jobs |
| `action` | `DomainEvent`: "PR opened", "review job finished", "comment posted" |
| `reducer` | `decide({ chat, rules, event, now })` in `apps/server/src/engine/decide.ts` |
| middleware doing the effects | the dispatcher (`chats/dispatch.ts`) and the task runner (`tasks/runner.ts`) |

`decide` returns three things: the new `chat`, the `timeline` items to show, and `commands` such as "queue a review job for Leo" or "post a GitHub review". It never does them itself; it only asks.

## Why bother

- **Tests are tables.** "Given this chat and this event, expect these commands." No database, no fake GitHub, no timers. Look at `engine/*.test.ts`.
- **It's deterministic.** Even the current time is passed in as `now`, so a test about a 30-second debounce doesn't wait 30 seconds.
- **Bugs are reproducible.** Load a chat, replay the event, get the same answer.

## How it's enforced

ESLint's `no-restricted-imports` rule (in `eslint.config.mjs`) fails the build if any file in `engine/` imports Prisma, Hono, the GitHub adapter or `node:fs`. `engine/purity.test.ts` checks that the rule keeps working.
