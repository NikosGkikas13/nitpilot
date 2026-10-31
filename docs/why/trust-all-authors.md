# Trust all authors: letting strangers in, but only to a sandbox

**In one sentence:** `trust_all_authors: true` in `.nitpilot.yml` lets a stranger's PR get a review on its own, but that review may only run on the fake agent, so nothing real ever reads or runs the stranger's code.

## The problem

Normally a review starts by itself only when the PR's author is trusted: an owner, member or collaborator, or a bot you listed (spec §6.1). A stranger's PR waits for someone to click **Review**. That's the right default: a PR is untrusted input, and a real agent reading it could be talked into things (see [prompt injection](prompt-injection.md)).

The public playground (Plan 4 G4) wants the opposite: anyone opens a PR to `nitpilot-playground` and gets a review right away, with nobody clicking anything.

## The idea: one flag, two locks

Think of it like a React feature flag that unlocks a screen, plus a route guard that still checks who you are. The flag alone isn't enough.

1. **The flag** (`trust_all_authors`) only changes *when* a review starts. The engine (`apps/server/src/engine/jobs.ts`, `startsOnItsOwn`) treats the PR as if trusted for that one decision. Everything else still sees the truth: `chat.trusted` stays `false`, so the stranger's own comments are still "for information only" and can't drive the agents.
2. **Lock one, on the server:** such a job is marked `fakeAgentOnly` (`fakeAgentOnly` in the same file). The assigner (`apps/server/src/jobs/assign.ts`) only hands it to a CLI that said "my agent is `fake`" when it connected. That also covers an older CLI that has never heard of the flag.
3. **Lock two, on your computer:** the CLI's executor (`apps/cli/src/runner/execute.ts`) checks the flag again and fails the job unless its agent is the fake one. Two checks in two places is called *defense in depth*: one bug doesn't open the door.

## Why the fake agent is safe here

- It's a script, not an AI. It reads the diff, matches a few patterns (a `<=` loop, a `console.log`, a `TODO`, a new function with no test) and writes canned points. No instructions in the PR reach a model.
- Review jobs never run the repo's `setup` command (only address jobs do), and git runs with hooks switched off ([safe git](safe-git.md)), so checking the PR out runs none of its code.
- A real agent never gets such a job.

The worst a stranger can do is get the fake review they asked for.
