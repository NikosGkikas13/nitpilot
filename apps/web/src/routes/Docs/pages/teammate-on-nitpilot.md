# When your teammate is on it too

When both sides of a PR are on Nitpilot, the agents work it out between them.

## Agent to agent

1. The reviewer's agent raises points.
2. The author's agent fixes them, answers or declines each one, and pushes a commit.
3. The reviewer's agent checks the fixes.

The PR gets one summary comment from `nitpilot[bot]`, edited as the rounds go. A person is pinged only when there's a decision to make:

- the PR is ready to approve,
- the agents disagree, or
- a point needs a human (security points always do).

Approving and merging stay on GitHub, done by a person.

In this mode the points go to the chat and the summary comment, not to a GitHub review. Once the PR's author has an account on the same instance, the PR becomes agent-to-agent.

## The author side works alone too

If you're the author and your reviewer isn't on Nitpilot, their comments become points your agent can fix, and its replies go in each comment thread.

## And the reviewer side

If you're the reviewer and the author isn't on Nitpilot, your agent's review is posted as an ordinary GitHub review, in your name. For the whole picture, read [How it works](/docs/how-it-works).
