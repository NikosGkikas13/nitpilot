import type { JobResult, NewPoint, PointDecision, PointReply, PushInfo } from '@nitpilot/protocol';

/**
 * What the agent produced in one job, kept here until the job ends. Nothing reaches the server
 * before `job.complete`, so a job is all-or-nothing (spec §10): a crash halfway posts nothing.
 */
export class ResultBuffer {
  private readonly points: NewPoint[] = [];
  // One answer per point: a second decision or reply on the same point replaces the first.
  private readonly decisions = new Map<number, PointDecision>();
  private readonly replies = new Map<number, PointReply>();
  private summary: string | null = null;

  /** Keep a new point. Returns how many points there are now. */
  addPoint(point: NewPoint): number {
    this.points.push(point);
    return this.points.length;
  }

  get pointCount(): number {
    return this.points.length;
  }

  decide(decision: PointDecision): void {
    this.decisions.set(decision.point, decision);
  }

  reply(reply: PointReply): void {
    this.replies.set(reply.point, reply);
  }

  finish(summary: string): void {
    this.summary = summary;
  }

  /** True when the agent wrote nothing at all (the runner reports that as `no_result`). */
  isEmpty(): boolean {
    return this.points.length === 0 && this.decisions.size === 0 && this.replies.size === 0 && this.summary === null;
  }

  /** The job's result for `job.complete`. Without a `finish`, the summary is made from what the agent did (spec §11). */
  toJobResult(push: PushInfo | null): JobResult {
    const decisions = [...this.decisions.values()];
    const replies = [...this.replies.values()];
    return { summary: this.summary ?? summarize(this.points.length, decisions, replies), points: [...this.points], decisions, replies, push };
  }
}

function summarize(points: number, decisions: PointDecision[], replies: PointReply[]): string {
  const parts: string[] = [];
  if (points > 0) parts.push(`Raised ${count(points, 'point')}.`);
  const resolved = decisions.filter((d) => d.decision === 'resolve').length;
  if (decisions.length > 0) parts.push(`Resolved ${resolved}, kept ${decisions.length - resolved} open.`);
  const by = (resolution: PointReply['resolution']) => replies.filter((r) => r.resolution === resolution).length;
  if (replies.length > 0) parts.push(`Fixed ${by('fixed')}, answered ${by('answered')}, declined ${by('declined')}.`);
  return parts.length > 0 ? parts.join(' ') : 'No findings.';
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
