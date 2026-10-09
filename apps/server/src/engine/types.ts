import type {
  ApplyState, Attention, Category, EscalationReason, FailureReason, JobResult, JobStatus, JobType,
  MessageKind, NotifyKind, Phase, PointOrigin, PointStatus, Resolution, Role, Severity, Side, Snippet, TeamRules,
} from '@nitpilot/protocol';

/** A person on GitHub. `userId` is their Nitpilot account, or null when they don't use Nitpilot. */
export type Person = { githubId: string; login: string; isBot: boolean; userId: string | null };

/** A person in one chat, in one role. Identified by `githubId + role`. */
export type ParticipantState = {
  githubId: string;
  login: string;
  role: Role;
  userId: string | null;
  isBot: boolean;
  /** Personal Auto switch. Always true in Plan 1. */
  auto: boolean;
  /** For reviewers: still a reviewer of this PR as far as Nitpilot is concerned. */
  requested: boolean;
  /** The head commit this reviewer's agent last reviewed; re-reviews start from here. */
  lastReviewedSha: string | null;
  attention: Attention;
};

/** One review point. Identified by its chat-local `number` (shown as P1, P2, …). */
export type PointState = {
  number: number;
  /** githubId of the reviewer who raised it. */
  raisedBy: string;
  origin: PointOrigin;
  jobId: string | null;
  /** Set when the point lives on GitHub: a GitHub comment, or our agent's comment posted there. */
  githubCommentId: string | null;
  githubThreadRootId: string | null;
  path: string | null;
  line: number | null;
  side: Side | null;
  commitSha: string | null;
  severity: Severity;
  category: Category;
  title: string;
  body: string;
  snippet: Snippet | null;
  status: PointStatus;
  authorResolution: Resolution | null;
  escalationReason: EscalationReason | null;
  /** Points from untrusted people never trigger automatic work (spec §6.1). */
  trusted: boolean;
  round: number;
};

/** A read-only view of a job. Jobs only change through commands. */
export type JobView = {
  id: string;
  participantGithubId: string;
  role: Role;
  jobType: JobType;
  status: JobStatus;
  round: number;
  attempt: number;
  headSha: string;
  applyState: ApplyState;
};

/** Everything the engine knows about one PR chat. */
export type ChatState = {
  phase: Phase;
  round: number;
  addressPasses: number;
  headSha: string;
  isDraft: boolean;
  /** The PR author is trusted (OWNER, MEMBER, COLLABORATOR or a trusted bot). */
  trusted: boolean;
  merged: boolean;
  closed: boolean;
  authorGithubId: string;
  participants: ParticipantState[];
  points: PointState[];
  /** Only jobs that are queued or running (plus any this decide() call changed). */
  jobs: JobView[];
};

/** A comment from GitHub, already normalized by the platform adapter. */
export type ExternalComment = {
  id: string;
  /** The root comment of the thread this replies to, or null for a new top-level comment. */
  threadRootId: string | null;
  author: Person;
  trusted: boolean;
  body: string;
  path: string | null;
  line: number | null;
  side: Side | null;
  commitSha: string | null;
};

export type ExternalReview = {
  id: string;
  author: Person;
  trusted: boolean;
  state: 'approved' | 'changes_requested' | 'commented';
  body: string;
  comments: ExternalComment[];
};

/** Everything that can happen to a chat (spec §9 DomainEvent). The same for every platform. */
export type DomainEvent =
  | { type: 'pr_opened'; author: Person; reviewers: Person[] }
  | { type: 'pr_reopened' }
  | { type: 'pr_ready' }
  | { type: 'pr_to_draft' }
  | { type: 'pr_closed'; merged: boolean }
  | { type: 'review_requested'; reviewer: Person }
  | { type: 'review_request_removed'; reviewer: Person }
  | { type: 'head_updated'; before: string; after: string; ours: boolean }
  | { type: 'external_comment'; comment: ExternalComment }
  | { type: 'external_comment_deleted'; commentId: string }
  | { type: 'external_review_submitted'; review: ExternalReview }
  | { type: 'thread_resolved'; threadRootId: string }
  | { type: 'thread_unresolved'; threadRootId: string }
  | { type: 'job_completed'; jobId: string; result: JobResult }
  | { type: 'job_failed'; jobId: string; reason: FailureReason; retryable: boolean }
  | { type: 'human_note'; author: Person; body: string }
  | { type: 'manual_review'; reviewer: Person }
  | { type: 'timer'; key: string }
  | { type: 'write_failed'; write: 'review' | 'replies'; asGithubId: string; pointNumbers: number[]; reason: 'needs_reauth' | 'github_error' };

export type ParticipantKey = { githubId: string; role: Role };

/** Side effects the engine asks for. The dispatcher turns them into Job and Task rows. */
export type Command =
  | { type: 'enqueue_job'; participant: ParticipantKey; jobType: JobType; round: number; sinceSha: string | null; applyState: 'pending' | 'draft' }
  | { type: 'cancel_jobs'; jobIds: string[]; reason: string }
  | { type: 'complete_job'; jobId: string; applyState: 'applied' | 'draft'; result: JobResult }
  | { type: 'retry_job'; jobId: string; runAfter: Date; refundAttempt: boolean }
  | { type: 'fail_job'; jobId: string; reason: FailureReason }
  | { type: 'schedule'; key: string; at: Date }
  | { type: 'unschedule'; key: string }
  | { type: 'upsert_summary' }
  | { type: 'post_review'; reviewerGithubId: string; pointNumbers: number[] }
  | { type: 'post_thread_replies'; asGithubId: string; replies: { pointNumber: number; body: string }[] }
  | { type: 'notify'; userIds: string[]; kind: NotifyKind; pointNumbers: number[] };

/** One new item for the chat timeline. `author` null means a system event. */
export type NewItem = {
  kind: MessageKind;
  author: { githubId: string; login: string } | null;
  pointNumber: number | null;
  jobId: string | null;
  body: string;
  data: Record<string, unknown> | null;
};

export type DecideInput = { chat: ChatState; rules: TeamRules; event: DomainEvent; now: Date };
export type DecideOutput = { chat: ChatState; timeline: NewItem[]; commands: Command[] };
