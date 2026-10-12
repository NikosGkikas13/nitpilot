import type { BundlePoint, NewPoint, PointDecision, PointReply } from '@nitpilot/protocol';
import type { McpJobContext } from '../context';
import { ToolError } from '../tool';
import { listChangedFiles } from './read';

/** The most points one review can raise: the team's `max_points_per_review`, and never more than a result holds. */
const RESULT_MAX_POINTS = 20;

/** What `add_point` takes: a NewPoint without its snippet (the CLI reads that itself, spec §11 step 7). */
export type PointInput = Omit<NewPoint, 'snippet' | 'path' | 'line' | 'side'> & {
  path?: string;
  line?: number;
  side?: NewPoint['side'];
};

/**
 * `add_point`: raise a point, on a file the PR changed (in a re-review, one changed since the last
 * review) that the team doesn't ignore, or on the PR as a whole (no path). Mistakes go back to the
 * agent as tool errors, so it can fix them.
 */
export async function addPoint(ctx: McpJobContext, input: PointInput): Promise<{ ref: string }> {
  const { bundle, buffer } = ctx;
  const max = Math.min(bundle.rules.maxPoints, RESULT_MAX_POINTS);
  if (buffer.pointCount >= max) throw new ToolError(`That's the most points one review may raise (${max}). Keep the ones that matter most.`);
  if (input.line !== undefined && input.path === undefined) throw new ToolError('A point on a line needs the path of its file.');
  if (input.path !== undefined) await checkPointPath(ctx, input.path);
  const n = buffer.addPoint({
    path: input.path ?? null,
    line: input.line ?? null,
    side: input.line === undefined ? null : (input.side ?? 'RIGHT'),
    severity: input.severity,
    category: input.category,
    title: input.title,
    body: input.body,
    snippet: null,
  });
  return { ref: `N${n}` };
}

async function checkPointPath(ctx: McpJobContext, path: string): Promise<void> {
  const since = ctx.bundle.type === 're_review' ? (ctx.bundle.sinceSha ?? undefined) : undefined;
  const { files } = await listChangedFiles(ctx, { since });
  const file = files.find((f) => f.path === path);
  if (!file) {
    const which = since ? `the files changed since the last review (${since.slice(0, 7)})` : 'the files this PR changes';
    throw new ToolError(`${path} isn't among ${which}, so a point can't go there. list_changed_files shows them.`);
  }
  if (file.ignored) throw new ToolError(`The team's ignore_paths cover ${path}, so it gets no points.`);
}

/** `decide_point`: in a re-review, resolve a point your agent raised earlier, or keep it open. */
export function decidePoint(ctx: McpJobContext, decision: PointDecision): string {
  const point = findPoint(ctx, decision.point);
  if (point.origin !== 'agent' || point.raisedBy !== ctx.bundle.you.login) {
    throw new ToolError(`P${point.number} was raised by ${point.origin === 'agent' ? `@${point.raisedBy}'s agent` : `@${point.raisedBy} on GitHub`}, not by you, so it isn't yours to decide.`);
  }
  if (point.status === 'resolved' || point.status === 'escalated') throw new ToolError(`P${point.number} is ${point.status}, so there's nothing to decide.`);
  ctx.buffer.decide(decision);
  return `P${point.number}: ${decision.decision === 'resolve' ? 'resolved' : 'kept open'}.`;
}

/** `reply_to_point`: in an address job, say how an open point was handled: fixed, answered or declined. */
export function replyToPoint(ctx: McpJobContext, reply: PointReply): string {
  const point = findPoint(ctx, reply.point);
  if (point.status !== 'open') throw new ToolError(`P${point.number} is ${point.status}, not open, so there's nothing to answer.`);
  ctx.buffer.reply(reply);
  return `P${point.number}: ${reply.resolution}.`;
}

/** `finish`: the agent's own summary of the job. Optional: without it, the CLI writes one. */
export function finish(ctx: McpJobContext, args: { summary: string }): string {
  ctx.buffer.finish(args.summary);
  return 'Summary saved. You can stop now.';
}

function findPoint(ctx: McpJobContext, number: number): BundlePoint {
  const point = ctx.bundle.points.find((p) => p.number === number);
  if (!point) throw new ToolError(`There's no P${number} in this PR. get_job lists its points.`);
  return point;
}
