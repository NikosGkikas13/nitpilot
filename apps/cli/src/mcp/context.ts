import type { JobBundle } from '@nitpilot/protocol';
import type { Worktree } from '../runner/worktree';

/** What one job's tools work on: the job, and its checkout of the PR. */
export type McpJobContext = {
  bundle: JobBundle;
  worktree: Pick<Worktree, 'dir' | 'git' | 'headSha' | 'baseSha' | 'conventions'>;
};
