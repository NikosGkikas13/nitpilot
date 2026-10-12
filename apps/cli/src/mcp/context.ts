import type { JobBundle } from '@nitpilot/protocol';
import type { Worktree } from '../runner/worktree';
import type { ResultBuffer } from './buffer';

/** What one job's tools work on: the job, its checkout of the PR, and where its answers collect. */
export type McpJobContext = {
  bundle: JobBundle;
  worktree: Pick<Worktree, 'dir' | 'git' | 'headSha' | 'baseSha' | 'conventions'>;
  buffer: ResultBuffer;
};
