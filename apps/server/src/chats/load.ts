import type { ApplyState, Attention, Category, EscalationReason, JobStatus, JobType, Phase, PointOrigin, PointStatus, Resolution, Role, Severity, Side, Snippet, TeamRules } from '@nitpilot/protocol';
import type { ChatState, PointState } from '../engine/types';
import type { Point } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { rulesFromJson } from './rules';

export type LoadedChat = { state: ChatState; rules: TeamRules };

/** Read one chat into the shape the engine works on. Status columns are strings in the DB; here they get their types back. */
export async function loadChat(chatId: string): Promise<LoadedChat> {
  const row = await prisma.prChat.findUniqueOrThrow({
    where: { id: chatId },
    include: {
      repo: true,
      participants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      points: { orderBy: { number: 'asc' } },
      jobs: { where: { status: { in: ['queued', 'running'] } }, include: { participant: true } },
    },
  });

  // Who uses Nitpilot can change after the chat started, so look it up fresh every time.
  const users = await prisma.user.findMany({ where: { githubId: { in: row.participants.map((p) => p.githubId) } }, select: { id: true, githubId: true } });
  const userIdOf = new Map(users.map((u) => [u.githubId, u.id]));

  const state: ChatState = {
    phase: row.phase as Phase,
    round: row.round,
    addressPasses: row.addressPasses,
    extraRounds: row.extraRounds,
    headSha: row.headSha,
    isDraft: row.isDraft,
    trusted: row.trusted,
    merged: row.merged,
    closed: row.closedAt !== null,
    authorGithubId: row.authorGithubId,
    participants: row.participants.map((p) => ({
      githubId: p.githubId,
      login: p.login,
      role: p.role as Role,
      userId: p.isBot ? null : (userIdOf.get(p.githubId) ?? null),
      isBot: p.isBot,
      auto: p.auto,
      requested: p.requested,
      lastReviewedSha: p.lastReviewedSha,
      attention: p.attention as Attention,
    })),
    points: row.points.map(toPointState),
    jobs: row.jobs.map((j) => ({
      id: j.id,
      participantGithubId: j.participant.githubId,
      role: j.participant.role as Role,
      jobType: j.type as JobType,
      status: j.status as JobStatus,
      round: j.round,
      attempt: j.attempt,
      refundedAttempts: j.refundedAttempts,
      headSha: j.headSha,
      applyState: j.applyState as ApplyState,
    })),
  };
  return { state, rules: rulesFromJson(row.repo.rulesJson) };
}

function toPointState(p: Point): PointState {
  return {
    number: p.number,
    raisedBy: p.raisedByGithubId,
    origin: p.origin as PointOrigin,
    jobId: p.jobId,
    githubCommentId: p.githubCommentId,
    githubThreadRootId: p.githubThreadRootId,
    path: p.path,
    line: p.line,
    side: p.side as Side | null,
    commitSha: p.commitSha,
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
