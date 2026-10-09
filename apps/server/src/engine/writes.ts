import { emit, system, type Ctx, type Ev } from './context';
import { onNitpilot } from './state';

/**
 * A review or replies in someone's name never reached GitHub: the task runner tried for about an
 * hour, or their GitHub sign-in expired. Nobody on GitHub will see those points, so tell the
 * person whose name it was (spec §15).
 */
export function onWriteFailed(ctx: Ctx, e: Ev<'write_failed'>): void {
  const people = ctx.chat.participants.filter((p) => p.githubId === e.asGithubId);
  const login = people[0]?.login ?? 'someone';
  const what = `${login}'s ${e.write === 'review' ? 'review' : 'replies'} (${e.pointNumbers.map((n) => `P${n}`).join(', ')})`;
  const why = e.reason === 'needs_reauth' ? `${login} needs to sign in to Nitpilot again` : 'GitHub kept failing';
  system(ctx, `Couldn't post ${what} on GitHub: ${why}`, { write: e.write, reason: e.reason, pointNumbers: e.pointNumbers });

  for (const p of people) p.attention = 'failed';
  const userIds = people.filter(onNitpilot).map((p) => p.userId!);
  if (userIds.length > 0) emit(ctx, { type: 'notify', userIds, kind: 'failed', pointNumbers: e.pointNumbers });
}
