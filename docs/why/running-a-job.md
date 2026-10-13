# Running a job on your laptop

**In one sentence:** when the server hands your CLI a job, one function (`createExecutor` in `apps/cli/src/runner/execute.ts`) checks the PR out, gives your agent its tools, runs it, pushes its fixes and sends back the result, and it always cleans up after itself (spec §11).

## The steps

1. **Is it mine?** A job for a repo you haven't linked on this device is turned down (`repo_not_linked`), and so is one your agent can't do (`unsupported_mode`, e.g. an address job for a review-only agent). The server then waits and tries again, or hands it to another device of yours.
2. **Check out the PR** in a worktree of its own (docs/why/git-worktrees.md).
3. **Address jobs only:** find where to push (a deleted fork fails here, before any work), then run the repo's `setup` command, e.g. `npm ci`.
4. **Give the job its tools:** register it on the local MCP server, which hands back the URL and the job's own token (docs/why/local-mcp-server.md). The token goes into a config file in a private temp folder, never onto the command line.
5. **Run the agent** with a short prompt that points it at `get_job`. Its progress lines go to the server as `job.progress`.
6. **Take the tools away:** the token stops working the moment the agent is done. An agent that used no Nitpilot tool at all fails the job with `no_result`.
7. **Address jobs only:** commit and push the agent's changes (docs/why/safe-git.md).
8. **Attach snippets,** the lines of code around each point, and send the result.
9. **Clean up,** whatever happened: the worktree, its folder and the job's refs go, in a `finally`.

## Failures, in the protocol's words

Anything that goes wrong on the way is a `JobFailure` with a reason the server understands (`setup_failed`, `branch_moved`, `git_error`, …) and whether trying again could help. The executor turns it into `job.fail`, and the server's retry rules decide what happens next. Anything else is a bug, which the daemon reports as a retryable `crash`.

## The React analogy

The executor is an async function with a `try/finally`, like a `useEffect` whose cleanup always runs: whether the job finished, failed or was cancelled (the `AbortSignal` the daemon passes in), the worktree is removed before the function returns.
