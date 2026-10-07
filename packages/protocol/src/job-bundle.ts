import { z } from 'zod';
import { Category, JobType, MessageKind, PointOrigin, PointStatus, Resolution, Role, Severity, Side } from './enums';

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
  thread: z.array(ThreadEntry),
});
export type BundlePoint = z.infer<typeof BundlePoint>;

/**
 * Everything the CLI needs to run one job, self-contained (spec §10 `job.assign`).
 * `headSha` is the PR head at assignment time: queued jobs follow the latest head.
 */
export const JobBundle = z.object({
  jobId: z.string().min(1),
  attempt: z.number().int().positive(),
  type: JobType,
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
  git: z.object({
    baseCloneUrl: z.string(),
    fetchRef: z.string(),
    /** `null` when the PR came from a fork that has been deleted: nothing can be pushed. */
    headRepoPath: z.string().nullable(),
    headBranch: z.string(),
  }),
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
export type JobBundle = z.infer<typeof JobBundle>;
