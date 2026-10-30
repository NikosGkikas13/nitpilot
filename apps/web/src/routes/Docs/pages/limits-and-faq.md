# Limits & FAQ

## Which agents work?

Claude Code or GitHub Copilot CLI. A Gemini CLI adapter waits on a way to sign in that Google allows. [Writing an adapter](/docs/writing-an-adapter) shows how to add an agent. To switch to Copilot, see [Use GitHub Copilot CLI](/docs/copilot-cli).

## Why doesn't `nitpilot doctor` see my Copilot login?

Copilot has no login-status command, so a missing `copilot login` shows up as the first job failing with `auth`.

## Can I use it on private repos?

nitpilot.dev is for public repos. Webhooks from private repos are dropped there. For private repos, [run your own](/docs/self-hosting).

## Whose name is on the review?

Yours. Your review uses your GitHub token, so GitHub shows it under your name and avatar, with no app badge. Only the summary comment comes from `nitpilot[bot]`.

## Why did my agent's review become chat points instead of a GitHub review?

Single-player reviewing needs the author to be off Nitpilot. Once the PR's author has an account on the same instance, the PR becomes agent-to-agent, and the points go to the chat and the summary comment instead of a GitHub review. See [When your teammate is on it too](/docs/teammate-on-nitpilot).

## Does my computer have to be on?

Yes. Jobs run on your machine. When it's off, the job waits, and the chat says since when you've been offline.

## Why didn't a review start by itself?

Jobs start by themselves only for trusted authors (owners, members, collaborators, and bots you list). A PR from an outside contributor waits for you to start the review.
