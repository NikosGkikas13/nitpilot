# The local MCP server: how an agent gets Nitpilot's tools

**In one sentence:** while a job runs, the daemon serves a tiny API on your own machine that only that job's agent can call, and that API decides which tools the agent gets (spec §11).

## What MCP is

MCP (Model Context Protocol) is a standard way for an AI agent to call tools someone else provides. Claude Code and Gemini CLI both speak it: you give them a URL, they ask it which tools it has (`tools/list`), and then they call one (`tools/call`) with JSON arguments. Each tool comes with a schema for its arguments, so the agent knows what to send, and the server refuses anything else.

Nitpilot's tools are the only way an agent sees the PR and records its work: `get_job`, `get_diff`, `add_point` and the rest (`apps/cli/src/mcp/job-tools.ts`). None of them is a shell, so the agent can't run commands.

## Why it runs on your machine

The agent runs on your laptop, in the job's own checkout, so the server is part of the daemon (`apps/cli/src/mcp/server.ts`). It listens on `127.0.0.1`, which only this machine can reach, on a port the operating system picks. The MCP SDK builds a fresh MCP server for every request, holding just the tools of the job that sent it.

## One token per job

Every job gets its own random token: 32 bytes (`apps/cli/src/mcp/tokens.ts`). The agent sends it with each request, as `Authorization: Bearer <token>`. The token decides which tools answer: a review's agent can raise points but never run checks, and two jobs running at once never see each other's data. When the job ends, the token is forgotten, so a late request gets `401`.

## Comparing tokens without giving them away

`a === b` stops at the first character that differs, so a wrong guess that starts right takes a tiny bit longer to reject. Over many tries, those differences tell an attacker how much of the token they have. `crypto.timingSafeEqual` always compares every byte, so a wrong guess takes the same time however close it is.

## DNS rebinding: why Host and Origin are checked

A web page can't normally read anything on `127.0.0.1`. But a trick called DNS rebinding makes `evil.example` point at `127.0.0.1` after the page has loaded, so the page's requests reach our port while the browser still thinks it's talking to `evil.example`. Those requests still say `Host: evil.example` and `Origin: https://evil.example`, so the server answers `403` to any Host or Origin that isn't localhost. They wouldn't have a token either: this is the second lock on the same door.

## The React analogy

- An MCP tool is a typed API endpoint, and its schema is the TypeScript type of its request body. The agent is the component calling it.
- A job's token is a session cookie for one browser tab: each tab (job) sees only its own state, and logging out (`unregister`) makes the old cookie worthless.
- The Host and Origin checks are CORS from the server's side: refusing requests that some other site's page made.
