import { BRAND, type Side } from '@nitpilot/protocol';
import { z } from 'zod';
import { prRefOf } from '../../chats/refs';
import type { Point } from '../../generated/prisma/client';
import { writeMarker } from '../../lib/markers';
import { prisma } from '../../lib/prisma';
import { GithubError } from '../../platform/github/client';
import type { PlatformWrites } from '../../platform/types';
import type { TaskHandler } from '../runner';
import { asUser, chatForTask, cleanerFor, nitpilotUserId } from './shared';

const Payload = z.object({ reviewerGithubId: z.string(), pointNumbers: z.array(z.number().int()) });
type Clean = (text: string, maxLength: number) => string;

const pointText = (p: Point, clean: Clean) => `**P${p.number} · ${p.severity} · ${p.category}:** ${clean(p.title, 200)}\n\n${clean(p.body, 4000)}`;

/** Single-player reviewer: post the agent's points as one GitHub review, as the reviewer (spec §6.1). */
export function reviewHandler(deps: { platform: PlatformWrites }): TaskHandler {
  return async (task) => {
    const { reviewerGithubId, pointNumbers } = Payload.parse(task.payload);
    const chat = await chatForTask(task.chatId);
    if (!chat) return;
    const userId = await nitpilotUserId(reviewerGithubId);
    const login = chat.participants.find((p) => p.githubId === reviewerGithubId)?.login ?? 'reviewer';
    const points = await prisma.point.findMany({ where: { chatId: chat.id, number: { in: pointNumbers } }, orderBy: { number: 'asc' } });
    const clean = cleanerFor(chat);
    const marker = writeMarker(chat.id, task.id);
    const header = `🤖 Review by ${login}'s agent · ${BRAND.name}`;
    const commitSha = points[0]?.commitSha ?? chat.headSha;
    const reuse = task.attempts > 1 ? { reuseIfContains: marker } : undefined;
    const bodyWith = (inBody: Point[]) => [header, ...inBody.map((p) => pointText(p, clean)), marker].join('\n\n');

    let inline = points.filter((p) => p.path && p.line);
    let result: { reviewId: string; commentIds: string[] };
    try {
      result = await asUser(() =>
        deps.platform.postReview(
          userId,
          prRefOf(chat),
          {
            commitSha,
            body: bodyWith(points.filter((p) => !inline.includes(p))),
            comments: inline.map((p) => ({
              path: p.path!,
              line: p.line!,
              side: (p.side ?? 'RIGHT') as Side,
              body: `${pointText(p, clean)}\n\n${writeMarker(chat.id, task.id, p.number)}`,
              diffRefs: { base: chat.baseSha, head: commitSha },
            })),
          },
          reuse,
        ),
      );
    } catch (err) {
      if (!(err instanceof GithubError && err.status === 422)) throw err;
      // GitHub refuses inline comments on lines outside the diff: put every point in the review body.
      inline = [];
      result = await asUser(() => deps.platform.postReview(userId, prRefOf(chat), { commitSha, body: bodyWith(points), comments: [] }, reuse));
    }

    await prisma.$transaction(async (tx) => {
      await tx.githubWrite.createMany({
        data: [{ chatId: chat.id, kind: 'review', githubId: result.reviewId }, ...result.commentIds.map((id) => ({ chatId: chat.id, kind: 'review_comment', githubId: id }))],
        skipDuplicates: true,
      });
      // Each inline point now lives in a GitHub thread; replies there will find it.
      for (const [i, p] of inline.entries()) {
        const commentId = result.commentIds[i];
        if (commentId) await tx.point.update({ where: { id: p.id }, data: { githubCommentId: commentId, githubThreadRootId: commentId } });
      }
    });
  };
}
