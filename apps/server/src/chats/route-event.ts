import type { TeamRules } from '@nitpilot/protocol';
import type { DomainEvent } from '../engine/types';
import type { PrChat } from '../generated/prisma/client';
import { getEnv } from '../lib/env';
import { containsMarker } from '../lib/markers';
import { prisma } from '../lib/prisma';
import { isTrustedAssociation } from '../platform/github/mapping';
import type { PlatformReads, PrNormalizedEvent, PrSnapshot } from '../platform/types';
import type { Dispatch } from './dispatch';
import { withPeople } from './people';
import { ensureFreshRules, rulesFromJson } from './rules';

export type RouterDeps = { platform: PlatformReads; dispatch: Dispatch };

/** Events after which a round may start, so the team rules should be current (spec §13). */
const ROUND_STARTERS: ReadonlySet<DomainEvent['type']> = new Set<DomainEvent['type']>(['pr_opened', 'pr_ready', 'pr_reopened', 'review_requested', 'head_updated', 'external_review_submitted', 'manual_review']);

/**
 * Get one PR event ready and hand it to the dispatcher. Returns null when it was dispatched,
 * or the reason it was ignored. Runs outside the chat lock, so it may call the platform.
 */
export async function routePrEvent(ne: PrNormalizedEvent, deps: RouterDeps): Promise<string | null> {
  let repo = await prisma.repo.findUnique({ where: { id: ne.pr.repoId } });
  if (!repo) return 'unknown repo (installation not synced)';
  if (getEnv().PUBLIC_REPOS_ONLY && repo.private) return 'private repo (public-only mode)';

  if (await isOwnWrite(ne.event)) return 'our own write';
  const fresh = await keepUnseenComments(ne.event);
  if (!fresh) return 'comment already handled';

  let chat = await prisma.prChat.findUnique({ where: { repoId_number: { repoId: repo.id, number: ne.pr.number } } });
  if (!chat || ROUND_STARTERS.has(fresh.type)) repo = await ensureFreshRules(repo, deps.platform);
  const rules = rulesFromJson(repo.rulesJson);
  let event = await withPeople(fresh, rules);

  if (!chat) {
    if (event.type === 'pr_closed') return 'closed PR that was never tracked';
    const snapshot = ne.snapshot ?? (await deps.platform.getPr(ne.pr));
    chat = await createChat(repo.id, snapshot, rules);
    // A PR we first meet through a comment or review still starts with "opened".
    if (event.type !== 'pr_opened') {
      await deps.dispatch(chat.id, await withPeople({ type: 'pr_opened', author: snapshot.author, reviewers: snapshot.requestedReviewers }, rules));
    }
  } else if (ne.snapshot) {
    await prisma.prChat.update({ where: { id: chat.id }, data: { title: ne.snapshot.title, body: ne.snapshot.body } });
  }

  if (event.type === 'head_updated') event = { ...event, ours: await isOurPush(chat, event.after) };
  await deps.dispatch(chat.id, event);
  return null;
}

async function createChat(repoId: string, s: PrSnapshot, rules: TeamRules): Promise<PrChat> {
  const trusted = isTrustedAssociation(s.authorAssociation) || (s.author.isBot && rules.trusted_bots.includes(s.author.login));
  return prisma.prChat.create({
    data: {
      repoId,
      number: s.ref.number,
      title: s.title,
      body: s.body,
      url: s.url,
      authorGithubId: s.author.githubId,
      headSha: s.headSha,
      baseSha: s.baseSha,
      baseRef: s.baseRef,
      headRef: s.headRef,
      headRepoFullName: s.headRepoFullName,
      isDraft: s.isDraft,
      trusted,
    },
  });
}

/** Our writes come back as webhooks; recognize them by marker or by the ids we stored (spec §15). */
async function isOwnWrite(event: DomainEvent): Promise<boolean> {
  if (event.type === 'external_comment') {
    if (containsMarker(event.comment.body)) return true;
    return (await prisma.githubWrite.count({ where: { githubId: event.comment.id } })) > 0;
  }
  if (event.type === 'external_comment_deleted') {
    return (await prisma.githubWrite.count({ where: { githubId: event.commentId } })) > 0;
  }
  if (event.type === 'external_review_submitted') {
    if (containsMarker(event.review.body)) return true;
    return (await prisma.githubWrite.count({ where: { kind: 'review', githubId: event.review.id } })) > 0;
  }
  return false;
}

/**
 * A comment can reach us twice: on its own, and inside its submitted review. Remember each
 * comment id once (SeenComment) and drop repeats. Returns null when nothing new is left.
 */
async function keepUnseenComments(event: DomainEvent): Promise<DomainEvent | null> {
  const isNew = async (commentId: string) => (await prisma.seenComment.createMany({ data: [{ commentId }], skipDuplicates: true })).count === 1;
  if (event.type === 'external_comment') return (await isNew(event.comment.id)) ? event : null;
  if (event.type === 'external_review_submitted') {
    const comments = [];
    for (const c of event.review.comments) if (await isNew(c.id)) comments.push(c);
    return { ...event, review: { ...event.review, comments } };
  }
  return event;
}

/** Our CLI announces each push with job.pushing before it happens (spec §10). */
async function isOurPush(chat: PrChat, sha: string): Promise<boolean> {
  return (await prisma.job.count({ where: { chatId: chat.id, expectedPushSha: sha } })) > 0;
}
