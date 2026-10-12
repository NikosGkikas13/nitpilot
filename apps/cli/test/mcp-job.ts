import type { JobBundle } from '@nitpilot/protocol';
import { onTestFinished } from 'vitest';
import { ResultBuffer } from '../src/mcp/buffer';
import type { McpJobContext } from '../src/mcp/context';
import { emptyHooksDir } from '../src/runner/safe-git';
import { SCRUB_PATHS } from '../src/runner/scrub';
import { prepareWorktree } from '../src/runner/worktree';
import type { prRepo } from './git-fixtures';
import { tempDir } from './temp';

/** A job's checkout of a test PR, ready for its MCP tools, removed when the test ends. `bundle` changes the job. */
export async function mcpJob(pr: ReturnType<typeof prRepo>, bundle: Partial<JobBundle> = {}): Promise<McpJobContext> {
  const job: JobBundle = { ...pr.bundle, ...bundle };
  const configDir = tempDir();
  const worktree = await prepareWorktree(job, pr.clone, { configDir, hooksDir: emptyHooksDir(configDir), scrubPaths: SCRUB_PATHS, env: pr.env });
  onTestFinished(() => worktree.cleanup());
  return { bundle: job, worktree, buffer: new ResultBuffer(), checks: {} };
}

/** Another commit on the PR's head (pushed where GitHub keeps it, refs/pull/142/head). Returns the bundle for the new head. */
export function moveHead(pr: ReturnType<typeof prRepo>, files: Parameters<ReturnType<typeof prRepo>['commit']>[1]): JobBundle {
  const headSha = pr.commit(pr.work, files, 'more work');
  pr.git(pr.work, 'push', '-q', pr.base, `HEAD:${pr.bundle.git.fetchRef}`);
  return { ...pr.bundle, pr: { ...pr.bundle.pr, headSha } };
}
