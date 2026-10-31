# Security

A pull request is untrusted input, and the agent reading it runs on your computer. So:

- **The agent gets tools, not a shell.** Each job starts a small local server (MCP) on `127.0.0.1` with a token that works for that job only. A reviewer can read the code and raise points, nothing else. An author's agent can also edit files and run the checks your repo allows (`npm test`, say), without a shell. Neither gets web access or a GitHub token.
- **The repo can't configure the agent.** Before the agent starts, the CLI deletes the files an agent would load by itself: `.claude/`, `.gemini/`, `.mcp.json`, `.env`, `CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, and Copilot's `.copilot/` and `.github/` instructions, agents, skills, prompts and hooks, at any depth and in any letter case. Git runs with hooks, symlinks and submodules off.
- **Text from the PR is marked as untrusted.** The title, body and comments reach the agent wrapped as data from an outside source, and the agent is told what that means.
- **Chats on public repos can be read by anyone with the link.** The page is read-only and trimmed: no notes to the agents, no waiting drafts, no failures, and no times your computer was last online. To turn it off, add `public_chats: false` to the repo's `.nitpilot.yml`. Private repos' chats always need a sign-in.
- **Your credentials stay yours.** Nitpilot never sees your Anthropic or Copilot login. Your GitHub token is stored encrypted on the server and used only to post your reviews and replies.

More in [prompt injection](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/prompt-injection.md), [safe git](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/safe-git.md) and [the local MCP server](https://github.com/NikosGkikas13/nitpilot/blob/main/docs/why/local-mcp-server.md). The [Architecture](/docs/architecture) page has the reasoning behind each choice.

## Reporting a vulnerability

Found a vulnerability? Please report it privately through [GitHub's vulnerability reporting](https://github.com/NikosGkikas13/nitpilot/security/advisories/new), not in a public issue.
