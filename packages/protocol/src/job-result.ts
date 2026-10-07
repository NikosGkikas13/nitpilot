import { z } from 'zod';
import { Category, Decision, Resolution, Severity, Side } from './enums';

/** ±5 lines of code around a point, read by the CLI with `git show` (spec §11 step 7). */
export const Snippet = z.object({
  startLine: z.number().int().positive(),
  lines: z.array(z.string()).max(40),
});
export type Snippet = z.infer<typeof Snippet>;

/** A point raised by a reviewer agent through `add_point`. */
export const NewPoint = z.object({
  path: z.string().min(1).nullable(),
  line: z.number().int().positive().nullable(),
  side: Side.nullable(),
  severity: Severity,
  category: Category,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  snippet: Snippet.nullable(),
});
export type NewPoint = z.infer<typeof NewPoint>;

/** A re-review decision through `decide_point`. `point` is the chat-local number (P3 → 3). */
export const PointDecision = z.object({
  point: z.number().int().positive(),
  decision: Decision,
  comment: z.string().max(4000),
});
export type PointDecision = z.infer<typeof PointDecision>;

/** An address-job answer through `reply_to_point`. */
export const PointReply = z.object({
  point: z.number().int().positive(),
  resolution: Resolution,
  comment: z.string().max(4000),
});
export type PointReply = z.infer<typeof PointReply>;

/** The commit an address job pushed. */
export const PushInfo = z.object({ from: z.string().min(7), to: z.string().min(7) });
export type PushInfo = z.infer<typeof PushInfo>;

/**
 * Everything an agent produced in one job. The CLI buffers tool calls locally and sends
 * this once, in `job.complete`, so a job is all-or-nothing (spec §10).
 */
export const JobResult = z.object({
  summary: z.string().max(4000),
  points: z.array(NewPoint).max(20),
  decisions: z.array(PointDecision),
  replies: z.array(PointReply),
  push: PushInfo.nullable(),
});
export type JobResult = z.infer<typeof JobResult>;
