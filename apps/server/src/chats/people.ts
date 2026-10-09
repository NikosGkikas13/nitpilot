import type { TeamRules } from '@nitpilot/protocol';
import type { DomainEvent, ExternalComment, Person } from '../engine/types';
import { prisma } from '../lib/prisma';

function peopleIn(event: DomainEvent): Person[] {
  switch (event.type) {
    case 'pr_opened':
      return [event.author, ...event.reviewers];
    case 'review_requested':
    case 'review_request_removed':
    case 'manual_review':
      return [event.reviewer];
    case 'human_note':
      return [event.author];
    case 'external_comment':
      return [event.comment.author];
    case 'external_review_submitted':
      return [event.review.author, ...event.review.comments.map((c) => c.author)];
    default:
      return [];
  }
}

/**
 * Fill in who uses Nitpilot (`userId`), and trust the bots the team listed in `trusted_bots`.
 * Platform adapters don't know about Nitpilot accounts; this is where they're added.
 */
export async function withPeople(event: DomainEvent, rules: TeamRules): Promise<DomainEvent> {
  const githubIds = peopleIn(event).map((p) => p.githubId);
  const users = githubIds.length ? await prisma.user.findMany({ where: { githubId: { in: githubIds } }, select: { id: true, githubId: true } }) : [];
  const userIdOf = new Map(users.map((u) => [u.githubId, u.id]));
  const fill = (p: Person): Person => ({ ...p, userId: p.isBot ? null : (userIdOf.get(p.githubId) ?? null) });
  const trusted = (p: Person, already: boolean) => already || (p.isBot && rules.trusted_bots.includes(p.login));
  const comment = (c: ExternalComment): ExternalComment => ({ ...c, author: fill(c.author), trusted: trusted(c.author, c.trusted) });

  switch (event.type) {
    case 'pr_opened':
      return { ...event, author: fill(event.author), reviewers: event.reviewers.map(fill) };
    case 'review_requested':
    case 'review_request_removed':
    case 'manual_review':
      return { ...event, reviewer: fill(event.reviewer) };
    case 'human_note':
      return { ...event, author: fill(event.author) };
    case 'external_comment':
      return { ...event, comment: comment(event.comment) };
    case 'external_review_submitted': {
      const r = event.review;
      return { ...event, review: { ...r, author: fill(r.author), trusted: trusted(r.author, r.trusted), comments: r.comments.map(comment) } };
    }
    default:
      return event;
  }
}
