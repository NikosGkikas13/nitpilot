import {
  JobResult,
  type ActivityView, type AgentJobType, type Attention, type Category, type ChatResponse, type ChatView, type DraftView, type EscalationReason, type ParticipantView, type Phase,
  type PointOrigin, type PointStatus, type PointView, type Resolution, type Role, type Severity, type Side, type Snippet,
} from '@nitpilot/protocol';
import type { Point, PrChat } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { loadActivity, type Activity, type LiveClis } from './activity';
import { failureKind, failureReasonOf } from './failed-flags';
import { permissionFacts, permissionsFor } from './permissions';
import { githubAvatar } from './inbox';
import { rulesFromJson } from './rules';
import { loadItemsBefore } from './timeline';

/** Who is looking: views differ per person (your role, your attention, your failure). */
export type ChatViewer = { githubId: string };

/**
 * One chat as `viewer` sees it (spec §10 `GET /api/chats/:owner/:repo/:number`, handoff §2): the PR, its people
 * and their agents right now, the points, the waiting drafts, the team rules. Read fresh each time, like the inbox:
 * presence and activity change without any event (docs/why/n-plus-one-queries.md keeps the number of queries fixed).
 */
export async function loadChatView(chatId: string, viewer: ChatViewer, clis: LiveClis, now = new Date()): Promise<ChatView> {
  const chat = await prisma.prChat.findUniqueOrThrow({
    where: { id: chatId },
    include: {
      repo: true,
      participants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true } } } },
      points: { orderBy: { number: 'asc' } },
      // The jobs at work (queued or running) and the drafts waiting for their owner, oldest first.
      jobs: {
        where: { OR: [{ status: { in: ['queued', 'running'] } }, { status: 'done', applyState: 'draft' }] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, participantId: true, status: true, type: true, headSha: true, createdAt: true, result: true, draftOfId: true, participant: { select: { githubId: true, login: true, role: true } } },
      },
    },
  });
  const running = chat.jobs.filter((j) => j.status === 'running');
  const active = chat.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const waitingDrafts = chat.jobs.filter((j) => j.status === 'done');
  const users = await prisma.user.findMany({ where: { githubId: { in: chat.participants.map((p) => p.githubId) } }, select: { id: true, githubId: true, avatarUrl: true } });
  const userOf = new Map(users.map((u) => [u.githubId, u]));
  const [activity, failure, seen] = await Promise.all([
    loadActivity(chatId, clis, now),
    failureKind(chatId, viewer.githubId),
    users.length > 0 ? prisma.cliToken.groupBy({ by: ['userId'], where: { userId: { in: users.map((u) => u.id) } }, _max: { lastSeenAt: true } }) : [],
  ]);
  // Why, in words, only when it was their agent that failed (a failed GitHub post has no reason to give).
  const failureReason = failure === 'agent' ? await failureReasonOf(chatId, viewer.githubId) : null;
  const lastSeen = (userId: string) => seen.find((s) => s.userId === userId)?._max.lastSeenAt ?? null;
  const loginOf = (githubId: string) => chat.participants.find((p) => p.githubId === githubId)?.login ?? githubId;
  const rules = rulesFromJson(chat.repo.rulesJson);
  const yours = chat.participants.filter((p) => p.githubId === viewer.githubId);

  const participants = chat.participants.map((p): ParticipantView => {
    const user = p.isBot ? undefined : userOf.get(p.githubId);
    const online = user ? clis.connectionsFor(user.id).length > 0 : false;
    return {
      githubId: p.githubId,
      login: p.login,
      avatarUrl: user?.avatarUrl ?? githubAvatar(p.githubId),
      role: p.role as Role,
      isBot: p.isBot,
      onNitpilot: user !== undefined,
      requested: p.requested,
      auto: p.auto,
      agent: user ? { online, offlineSince: online ? null : (lastSeen(user.id)?.toISOString() ?? null), working: running.some((j) => j.participantId === p.id) } : null,
    };
  });

  return {
    id: chat.id,
    repo: chat.repo.fullName,
    number: chat.number,
    title: chat.title,
    url: chat.url,
    author: loginOf(chat.authorGithubId),
    headRef: chat.headRef,
    baseRef: chat.baseRef,
    phase: chat.phase as Phase,
    round: chat.round,
    // The limit with the rounds people granted with Continue (spec §9.3); `rules.maxRounds` is the team's own.
    maxRounds: rules.max_rounds + chat.extraRounds,
    merged: chat.merged,
    closed: chat.closedAt !== null,
    trusted: chat.trusted,
    isDraft: chat.isDraft,
    viewer: {
      role: yours.some((p) => p.role === 'author') ? 'author' : yours.length > 0 ? 'reviewer' : null,
      attention: (yours.find((p) => p.attention !== 'none')?.attention ?? 'none') as Attention,
      failure,
      failureReason,
    },
    participants,
    activity: activityView(activity),
    points: chat.points.map((p) => pointView(chat, p, loginOf(p.raisedByGithubId))),
    // Everyone who reads the chat sees them; Send and Discard are only the owner's (`permissions.drafts`).
    drafts: waitingDrafts.map((d): DraftView => ({
      jobId: d.id,
      owner: d.participant.login,
      role: d.participant.role as Role,
      jobType: d.type as AgentJobType,
      headSha: d.headSha,
      createdAt: d.createdAt.toISOString(),
      // Parsed, so a result stored before a field existed gets that field's default (`draft: null`).
      result: JobResult.parse(d.result),
      // Being sent: an author's publish job for it is queued or running (spec §9 "Drafts").
      sending: active.some((j) => j.draftOfId === d.id),
    })),
    rules: { maxRounds: rules.max_rounds, alwaysEscalate: rules.always_escalate, autoReview: rules.auto.review, autoAddress: rules.auto.address, error: chat.repo.rulesError },
    permissions: permissionsFor(viewer, permissionFacts({ ...chat, waitingDrafts })),
    summaryUrl: chat.summaryCommentId ? `${chat.url}#issuecomment-${chat.summaryCommentId}` : null,
    lastSeq: chat.lastSeq,
  };
}

/** What the chat screen loads first: the view, and the newest page of the timeline. */
export async function loadChatPage(chatId: string, viewer: ChatViewer, clis: LiveClis): Promise<ChatResponse> {
  const [view, page] = await Promise.all([loadChatView(chatId, viewer, clis), loadItemsBefore(chatId, null)]);
  return { view, ...page };
}

function activityView(a: Activity): ActivityView {
  switch (a.kind) {
    case 'agent_working':
      return { kind: a.kind, who: a.who, why: null, offlineSince: null };
    case 'agent_waiting':
      return { kind: a.kind, who: a.who, why: a.why, offlineSince: a.why === 'offline' ? (a.offlineSince?.toISOString() ?? null) : null };
    case 'human_turn':
      return { kind: a.kind, who: a.who, why: null, offlineSince: null };
    case 'none':
      return { kind: a.kind, who: null, why: null, offlineSince: null };
  }
}

function pointView(chat: PrChat, p: Point, raisedByLogin: string): PointView {
  return {
    number: p.number,
    raisedBy: { githubId: p.raisedByGithubId, login: raisedByLogin },
    origin: p.origin as PointOrigin,
    path: p.path,
    line: p.line,
    side: p.side as Side | null,
    url: fileUrl(chat, p),
    severity: p.severity as Severity,
    category: p.category as Category,
    title: p.title,
    body: p.body,
    snippet: p.snippet as Snippet | null,
    status: p.status as PointStatus,
    authorResolution: p.authorResolution as Resolution | null,
    escalationReason: p.escalationReason as EscalationReason | null,
    trusted: p.trusted,
    round: p.round,
  };
}

/**
 * The point's line on GitHub, in the commit it was raised on. A comment on the left side of a diff is about the
 * old code, so it links to the base commit.
 */
function fileUrl(chat: PrChat, p: Point): string | null {
  if (!p.path) return null;
  const repoUrl = chat.url.replace(/\/pull\/\d+$/, '');
  const sha = p.side === 'LEFT' ? chat.baseSha : (p.commitSha ?? chat.headSha);
  const path = p.path.split('/').map(encodeURIComponent).join('/');
  return `${repoUrl}/blob/${sha}/${path}${p.line ? `#L${p.line}` : ''}`;
}
