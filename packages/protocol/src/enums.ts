import { z } from 'zod';

// Each enum is a zod schema (for runtime checks) and a type with the same name.

export const Severity = z.enum(['blocker', 'major', 'minor', 'nit']);
export type Severity = z.infer<typeof Severity>;

export const Category = z.enum(['security', 'bug', 'performance', 'design', 'tests', 'style', 'docs', 'other']);
export type Category = z.infer<typeof Category>;

export const PointStatus = z.enum(['open', 'addressed', 'resolved', 'escalated']);
export type PointStatus = z.infer<typeof PointStatus>;

/** Where a point came from: an agent's review, or a comment on GitHub. */
export const PointOrigin = z.enum(['agent', 'github']);
export type PointOrigin = z.infer<typeof PointOrigin>;

/** Whose turn it is in a chat (spec §9.1). */
export const Phase = z.enum(['idle', 'reviewing', 'addressing', 'ready', 'escalated', 'closed']);
export type Phase = z.infer<typeof Phase>;

export const Role = z.enum(['author', 'reviewer']);
export type Role = z.infer<typeof Role>;

/** Why a person is needed. Stored per participant because "needs you" is personal. */
export const Attention = z.enum(['none', 'decision', 'manual_review', 'failed', 'drafts']);
export type Attention = z.infer<typeof Attention>;

/** `publish` (Plan 2) pushes an author's draft commit: the CLI runs git, no agent (spec §11 "Publish jobs"). */
export const JobType = z.enum(['review', 're_review', 'address', 'publish']);
export type JobType = z.infer<typeof JobType>;

/** The job types an agent runs. */
export const AgentJobType = JobType.exclude(['publish']);
export type AgentJobType = z.infer<typeof AgentJobType>;

export const JobStatus = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

export const ApplyState = z.enum(['pending', 'applied', 'draft', 'discarded']);
export type ApplyState = z.infer<typeof ApplyState>;

export const MessageKind = z.enum(['point_raised', 'point_reply', 'point_decision', 'job_summary', 'human', 'system']);
export type MessageKind = z.infer<typeof MessageKind>;

/** How the author's agent answered a point. */
export const Resolution = z.enum(['fixed', 'answered', 'declined']);
export type Resolution = z.infer<typeof Resolution>;

/** How the reviewer's agent judged an answer. */
export const Decision = z.enum(['resolve', 'keep_open']);
export type Decision = z.infer<typeof Decision>;

export const EscalationReason = z.enum(['category', 'disagreement', 'round_limit']);
export type EscalationReason = z.infer<typeof EscalationReason>;

/** Which side of a diff a comment is anchored to (GitHub's terms). */
export const Side = z.enum(['LEFT', 'RIGHT']);
export type Side = z.infer<typeof Side>;

export const AgentId = z.enum(['claude-code', 'gemini-cli', 'copilot', 'fake']);
export type AgentId = z.infer<typeof AgentId>;

export const AgentMode = z.enum(['reviewer', 'editor']);
export type AgentMode = z.infer<typeof AgentMode>;

export const NotifyKind = z.enum(['ready', 'escalated', 'manual_review', 'failed', 'drafts']);
export type NotifyKind = z.infer<typeof NotifyKind>;

export const FailureReason = z.enum([
  // How an agent run can end badly (spec §12.2)
  'auth', 'quota', 'max_turns', 'crash', 'timeout', 'no_result',
  // Git and checkout problems (spec §11)
  'stale_head', 'branch_moved', 'setup_failed', 'git_error',
  // The CLI turned the job down
  'daily_cap', 'repo_not_linked', 'unsupported_mode',
]);
export type FailureReason = z.infer<typeof FailureReason>;
