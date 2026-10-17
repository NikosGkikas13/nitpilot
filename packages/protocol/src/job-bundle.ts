import { z } from 'zod';
import { AgentJobType, Category, MessageKind, PointOrigin, PointStatus, Resolution, Role, Severity, Side } from './enums';

/** One entry in a point's thread: a reply, a decision, or a human note about it. */
export const ThreadEntry = z.object({
  author: z.string(),
  kind: MessageKind,
  body: z.string(),
  at: z.string(),
});

/** A point as an agent sees it in `get_job`. */
export const BundlePoint = z.object({
  number: z.number().int().positive(),
  origin: PointOrigin,
  raisedBy: z.string(),
  path: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  side: Side.nullable(),
  severity: Severity,
  category: Category,
  title: z.string(),
  body: z.string(),
  status: PointStatus,
  authorResolution: Resolution.nullable(),
  round: z.number().int().positive(),
  /** False for a GitHub comment from someone outside the repo (spec §6.1): the agent may read it, never act on it. */
  trusted: z.boolean(),
  thread: z.array(ThreadEntry),
});
export type BundlePoint = z.infer<typeof BundlePoint>;

/**
 * How the CLI gets the PR's code and where it pushes (spec §11 steps 1 and 6). The platform adapter fills it in
 * (`gitSpec`), so a GitLab adapter can name its own refs.
 */
export const BundleGit = z.object({
  baseCloneUrl: z.string(),
  fetchRef: z.string(),
  /** `null` when the PR came from a fork that has been deleted: nothing can be pushed. */
  headRepoPath: z.string().nullable(),
  headBranch: z.string(),
});
export type BundleGit = z.infer<typeof BundleGit>;

/**
 * Everything the CLI needs to run one agent job, self-contained (spec §10 `job.assign`).
 * `headSha` is the PR head at assignment time: queued jobs follow the latest head.
 */
export const AgentJobBundle = z.object({
  jobId: z.string().min(1),
  attempt: z.number().int().positive(),
  type: AgentJobType,
  round: z.number().int().positive(),
  maxRounds: z.number().int().positive(),
  /** `draft`: do the work but don't publish or push it (Auto is off). */
  apply: z.enum(['auto', 'draft']),
  you: z.object({ login: z.string(), role: Role }),
  pr: z.object({
    repoFullName: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    url: z.string(),
    authorLogin: z.string(),
    baseRef: z.string(),
    headRef: z.string(),
    baseSha: z.string(),
    headSha: z.string(),
  }),
  git: BundleGit,
  /** For re-reviews: only look at commits after this one. `null` means review everything. */
  sinceSha: z.string().nullable(),
  points: z.array(BundlePoint),
  notes: z.array(z.object({ author: z.string(), body: z.string(), at: z.string() })),
  rules: z.object({
    ignorePaths: z.array(z.string()),
    alwaysEscalate: z.array(Category),
    maxPoints: z.number().int().positive(),
  }),
});
export type AgentJobBundle = z.infer<typeof AgentJobBundle>;

/**
 * A publish job (spec §11 "Publish jobs"): push the draft commit an author's address job left in the linked clone,
 * at `refs/nitpilot/drafts/<draft.jobId>`. `draft.sha` is that commit and `draft.from` the head it was made on.
 * No agent runs, so there are no points, notes or rules.
 */
export const PublishBundle = z.object({
  jobId: z.string().min(1),
  attempt: z.number().int().positive(),
  type: z.literal('publish'),
  pr: z.object({
    repoFullName: z.string(),
    number: z.number().int().positive(),
    headRef: z.string(),
    url: z.string(),
  }),
  git: BundleGit,
  draft: z.object({ jobId: z.string().min(1), sha: z.string().min(7), from: z.string().min(7) }),
});
export type PublishBundle = z.infer<typeof PublishBundle>;

/** What `job.assign` carries: an agent job, or a publish job. `type` tells them apart. */
export const JobBundle = z.discriminatedUnion('type', [AgentJobBundle, PublishBundle]);
export type JobBundle = z.infer<typeof JobBundle>;
