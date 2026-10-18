import type {
  ApplyState, Attention, Category, EscalationReason, FailureReason, JobResult, JobStatus, JobType,
  MessageKind, NotifyKind, Phase, PointOrigin, PointStatus, Resolution, Role, Severity, Side, Snippet, TeamRules,
} from '@nitpilot/protocol';

/**
 * A person on GitHub. `userId` is their Nitpilot account, or null when they don't use Nitpilot. `autoDefaults` are
 * their Auto-review and Auto-fix settings for new chats (`User.autoReview` / `autoAddress`), filled in for people on
 * Nitpilot (chats/people.ts); without them a new participant starts with Auto on.
 */
export type Person = { githubId: string; login: string; isBot: boolean; userId: string | null; autoDefaults?: { review: boolean; address: boolean } };

/** A person in one chat, in one role. Identified by `githubId + role`. */
export type ParticipantState = {
  githubId: string;
  login: string;
  role: Role;
  userId: string | null;
  isBot: boolean;
  /** Personal Auto switch in this chat (spec §9 "Auto"). Off: the agent still runs, and its result waits as a draft. */
  auto: boolean;
  /** For reviewers: still a reviewer of this PR as far as Nitpilot is concerned. */
  requested: boolean;
  /** The head commit this reviewer's agent last reviewed; re-reviews start from here. */
  lastReviewedSha: string | null;
  attention: Attention;
  /**
   * For the author: they discarded their agent's drafted fixes, so the open points are theirs to do by hand. No
   * address job starts until something changes (spec §9 "Drafts").
   */
  byHand: boolean;
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
  /** How many times it was handed to a CLI. Only ever grows, so (job, attempt) names one run. */
  attempt: number;
  /** How many of those hand-outs don't count toward the retry limit (quota, a moved branch). */
  refundedAttempts: number;
  headSha: string;
  applyState: ApplyState;
  /** For a publish job: the draft job whose commit it pushes. */
  draftOfId: string | null;
};

/**
 * A finished job whose result waits for its owner to Send or Discard (spec §9 "Drafts"). It is still waiting while
 * the publish job that sends it is queued or running.
 */
export type DraftState = {
  jobId: string;
  participantGithubId: string;
  role: Role;
  jobType: JobType;
  /** The head commit the agent worked on. */
  headSha: string;
  /** What the agent produced, stored with the job. */
  result: JobResult;
};

/** Everything the engine knows about one PR chat. */
export type ChatState = {
  phase: Phase;
  round: number;
  addressPasses: number;
  /** Address passes people granted beyond the team's max_rounds, by pressing Continue at the limit (spec §9.2). */
  extraRounds: number;
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
  /** The drafts waiting for their owner, oldest first. */
  drafts: DraftState[];
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
  | { type: 'job_completed'; jobId: string; attempt: number; result: JobResult }
  | { type: 'job_failed'; jobId: string; attempt: number; reason: FailureReason; retryable: boolean }
  | { type: 'retry_requested'; who: Person }
  | { type: 'human_note'; author: Person; body: string }
  | { type: 'manual_review'; reviewer: Person }
  | { type: 'timer'; key: string }
  | { type: 'write_failed'; write: 'review' | 'replies'; asGithubId: string; pointNumbers: number[]; reason: 'needs_reauth' | 'github_error' }
  /** The PR now targets another branch. `trusted` is the author's trust, checked again. */
  | { type: 'pr_retargeted'; baseRef: string; trusted: boolean }
  /** Someone flagged by write_failed signed in again, in these roles (the ones whose flag came from a failed write). */
  | { type: 'signed_in_again'; who: Person; roles: Role[] }
  /** Resolve on an escalated point, from the web app (spec §9.2): only the reviewer who raised it. */
  | { type: 'point_resolve'; who: Person; point: number }
  /** Continue on an escalated point, from the web app: the author or the reviewer who raised it. */
  | { type: 'point_continue'; who: Person; point: number }
  /** A person's Auto switch in this chat, from the web app: only for a role they have (spec §9 "Auto"). */
  | { type: 'auto_changed'; who: Person; role: Role; on: boolean }
  /** Send on a waiting draft, from the web app: only its owner (spec §9 "Drafts"). */
  | { type: 'draft_send'; who: Person; jobId: string }
  /** Discard on a waiting draft, from the web app: only its owner. */
  | { type: 'draft_discard'; who: Person; jobId: string };

export type ParticipantKey = { githubId: string; role: Role };

/** Side effects the engine asks for. The dispatcher turns them into Job and Task rows. */
export type Command =
  /** `draftOfId` is set for a publish job: the draft it pushes. */
  | { type: 'enqueue_job'; participant: ParticipantKey; jobType: JobType; round: number; sinceSha: string | null; applyState: 'pending' | 'draft'; draftOfId: string | null }
  | { type: 'cancel_jobs'; jobIds: string[]; reason: string }
  | { type: 'complete_job'; jobId: string; applyState: 'applied' | 'draft'; result: JobResult }
  /** `reason` is why its last run ended; the "waiting" status shows it (chats/activity.ts). */
  | { type: 'retry_job'; jobId: string; runAfter: Date; refundAttempt: boolean; reason: FailureReason }
  | { type: 'fail_job'; jobId: string; reason: FailureReason }
  /** A queued job follows a new Auto setting; a draft is applied (sent) or discarded. */
  | { type: 'set_apply_state'; jobId: string; applyState: ApplyState }
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
