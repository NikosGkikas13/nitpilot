import type { AgentJobBundle } from '@nitpilot/protocol';
import type { Worktree } from '../runner/worktree';
import type { ResultBuffer } from './buffer';

/** What one job's tools work on: the job, its checkout of the PR, where its answers collect, and the checks it may run. */
export type McpJobContext = {
  bundle: AgentJobBundle;
  worktree: Pick<Worktree, 'dir' | 'git' | 'headSha' | 'baseSha' | 'conventions'>;
  buffer: ResultBuffer;
  /** The repo's `checks` from your config (spec §13): a name, and the command it runs. */
  checks: Readonly<Record<string, readonly string[]>>;
};
