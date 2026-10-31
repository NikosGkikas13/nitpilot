import type { EscalationReason, Phase, PointStatus, Resolution } from '@nitpilot/protocol';
import { prRefOf } from '../../chats/refs';
import { rulesFromJson } from '../../chats/rules';
import { renderSummary } from '../../engine/summary';
import { summaryMarker } from '../../lib/markers';
import { prisma } from '../../lib/prisma';
import { transcriptUrl } from '../../lib/urls';
import type { PlatformWrites } from '../../platform/types';
import type { TaskHandler } from '../runner';
import { chatForTask, cleanerFor } from './shared';

/** Create or edit the one summary comment (spec §15). */
export function summaryHandler(deps: { platform: PlatformWrites }): TaskHandler {
  return async (task) => {
    const chat = await chatForTask(task.chatId);
    if (!chat) return;
    const points = await prisma.point.findMany({ where: { chatId: chat.id }, orderBy: { number: 'asc' } });
    // The author agent's latest reply per point: its commit ("fixed in …") and its words.
    const replies = await prisma.message.findMany({ where: { chatId: chat.id, kind: 'point_reply' }, orderBy: { seq: 'asc' } });
    const lastReply = new Map(replies.map((m) => [m.pointNumber, { body: m.body, commit: (m.data as { commit?: string | null } | null)?.commit ?? null }]));
    const clean = cleanerFor(chat);

    const { body, hash } = renderSummary(
      {
        chatId: chat.id,
        phase: chat.phase as Phase,
        merged: chat.merged,
        round: chat.round,
        transcriptUrl: transcriptUrl(chat.repo.fullName, chat.number),
        reviewers: chat.participants.filter((p) => p.role === 'reviewer' && p.userId && !p.isBot).map((p) => p.login),
        footer: rulesFromJson(chat.repo.rulesJson).footer,
        points: points.map((p) => ({
          number: p.number,
          title: p.title,
          status: p.status as PointStatus,
          authorResolution: p.authorResolution as Resolution | null,
          escalationReason: p.escalationReason as EscalationReason | null,
          fixedIn: lastReply.get(p.number)?.commit ?? null,
          authorComment: lastReply.get(p.number)?.body ?? null,
        })),
      },
      (text) => clean(text, 4000),
    );
    if (hash === chat.summaryHash) return; // nothing changed: no GitHub request

    const reuse = task.attempts > 1 ? { reuseIfContains: summaryMarker(chat.id) } : undefined;
    const { id } = await deps.platform.upsertSummary(prRefOf(chat), body, chat.summaryCommentId ?? undefined, reuse);
    await prisma.$transaction([
      prisma.prChat.update({ where: { id: chat.id }, data: { summaryCommentId: id, summaryHash: hash } }),
      prisma.githubWrite.createMany({ data: [{ chatId: chat.id, kind: 'summary', githubId: `issue:${id}` }], skipDuplicates: true }),
    ]);
  };
}
