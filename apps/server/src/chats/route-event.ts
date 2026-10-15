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
    if (event.type === 'pr_retargeted') return 'retargeted PR that was never tracked';
    const snapshot = ne.snapshot ?? (await deps.platform.getPr(ne.pr));
    chat = await createChat(repo.id, snapshot, rules);
    // A PR we first meet through a comment or review still starts with "opened".
    if (event.type !== 'pr_opened') {
      await deps.dispatch(chat.id, await withPeople({ type: 'pr_opened', author: snapshot.author, reviewers: snapshot.requestedReviewers }, rules));
    }
  } else if (ne.snapshot) {
    // The base too: a PR can be retargeted, and the next job must fetch the branch it targets now.
    const { title, body, baseRef, baseSha } = ne.snapshot;
    await prisma.prChat.update({ where: { id: chat.id }, data: { title, body, baseRef, baseSha } });
  }

  if (event.type === 'head_updated') event = { ...event, ours: await isOurPush(chat, event.after) };
  if (event.type === 'pr_retargeted' && ne.snapshot) event = { ...event, trusted: isTrustedAuthor(ne.snapshot, rules) };
  await deps.dispatch(chat.id, event, { seenCommentIds: commentIdsOf(fresh) });
  return null;
}

/** OWNER, MEMBER or COLLABORATOR of the repo, or a bot the team trusts (spec §6.1). */
function isTrustedAuthor(s: PrSnapshot, rules: TeamRules): boolean {
  return isTrustedAssociation(s.authorAssociation) || (s.author.isBot && rules.trusted_bots.includes(s.author.login));
}

async function createChat(repoId: string, s: PrSnapshot, rules: TeamRules): Promise<PrChat> {
  const trusted = isTrustedAuthor(s, rules);
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
  if (event.type === 'external_comment') return isOwnComment(event.comment);
  if (event.type === 'external_comment_deleted') {
    return (await prisma.githubWrite.count({ where: { githubId: event.commentId } })) > 0;
  }
  if (event.type === 'external_review_submitted') {
    const { review } = event;
    if (containsMarker(review.body)) return true;
    if ((await prisma.githubWrite.count({ where: { kind: 'review', githubId: review.id } })) > 0) return true;
    // GitHub wraps each reply our agent posts in a review of its own, with no body: it's ours when all it holds is ours.
    if (review.body.trim() || review.comments.length === 0) return false;
    for (const c of review.comments) if (!(await isOwnComment(c))) return false;
    return true;
  }
  return false;
}

async function isOwnComment(comment: { id: string; body: string }): Promise<boolean> {
  if (containsMarker(comment.body)) return true;
  return (await prisma.githubWrite.count({ where: { githubId: comment.id } })) > 0;
}

/**
 * A comment can reach us twice: on its own, and inside its submitted review. Drop the comments
 * already handled (SeenComment). Returns null when nothing new is left. This only reads: the
 * dispatcher marks the comments as seen when it saves the event, so if anything fails before
 * that, a retry still handles them.
 */
async function keepUnseenComments(event: DomainEvent): Promise<DomainEvent | null> {
  const ids = commentIdsOf(event);
  if (ids.length === 0) return event;
  const seen = new Set((await prisma.seenComment.findMany({ where: { commentId: { in: ids } }, select: { commentId: true } })).map((s) => s.commentId));
  if (event.type === 'external_comment') return seen.has(event.comment.id) ? null : event;
  if (event.type === 'external_review_submitted') {
    return { ...event, review: { ...event.review, comments: event.review.comments.filter((c) => !seen.has(c.id)) } };
  }
  return event;
}

function commentIdsOf(event: DomainEvent): string[] {
  if (event.type === 'external_comment') return [event.comment.id];
  if (event.type === 'external_review_submitted') return event.review.comments.map((c) => c.id);
  return [];
}

/** Our CLI announces each push with job.pushing before it happens (spec §10). */
async function isOurPush(chat: PrChat, sha: string): Promise<boolean> {
  return (await prisma.job.count({ where: { chatId: chat.id, expectedPushSha: sha } })) > 0;
}
