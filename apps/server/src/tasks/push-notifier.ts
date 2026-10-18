import { prisma } from '../lib/prisma';
import type { Notification, Notifier } from './notifier';
import type { PushResult, PushSend } from './web-push-send';

/** A subscription that failed this many times in a row (without a 404 or 410) is deleted. */
export const MAX_PUSH_FAILURES = 5;

/** What the service worker gets (Task 20 shows it): heading, detail, where a click goes, and the chat as the tag. */
export type PushPayload = { title: string; body: string; url: string; tag: string };

type Subscription = { id: string; userId: string; endpoint: string; p256dh: string; auth: string; failCount: number };

/**
 * Web Push notifications (spec §16, docs/why/web-push.md): each notification goes to every browser and device a
 * person subscribed, one after another. One that arrives reaches the person. A subscription the push service calls
 * gone (404 or 410) is deleted; any other failure counts against it, and the fifth in a row deletes it (a success
 * starts the count again). A failed send never stops the others: only a database error fails the notify task, which
 * is then retried, and may push a second time to someone it already reached (accepted: rare, and harmless).
 *
 * `send` is null when the server has no VAPID keys: push is off, nobody is reached, and the rows are left alone.
 */
export class PushNotifier implements Notifier {
  constructor(private readonly send: PushSend | null) {}

  async notify(n: Notification): Promise<{ reached: string[] }> {
    if (!this.send || n.userIds.length === 0) return { reached: [] };
    const payload: PushPayload = { title: n.title, body: n.body, url: n.url, tag: n.chatId };
    const message = JSON.stringify(payload);
    // Everyone's subscriptions in one query, oldest first.
    const subscriptions = await prisma.pushSubscription.findMany({ where: { userId: { in: n.userIds } }, orderBy: { createdAt: 'asc' } });
    const reached = new Set<string>();
    for (const sub of subscriptions) {
      const result = await this.sendOne(this.send, sub, message);
      await record(sub, result);
      if (result.ok) reached.add(sub.userId);
    }
    return { reached: n.userIds.filter((id) => reached.has(id)) };
  }

  /** Send to one subscription. A sender that throws (it shouldn't) counts as a failure, like any other. */
  private async sendOne(send: PushSend, sub: Subscription, message: string): Promise<PushResult> {
    try {
      return await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, message);
    } catch (err) {
      return { ok: false, gone: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

/**
 * Keep the row honest about how sending went. `updateMany` / `deleteMany` by id, so a row the person removed meanwhile
 * (they turned push off while we sent) is simply skipped instead of failing the task.
 */
async function record(sub: Subscription, result: PushResult): Promise<void> {
  if (result.ok) {
    if (sub.failCount > 0) await prisma.pushSubscription.updateMany({ where: { id: sub.id }, data: { failCount: 0 } });
    return;
  }
  if (result.gone) {
    await prisma.pushSubscription.deleteMany({ where: { id: sub.id } });
    return;
  }
  console.warn(`[push] a subscription of user ${sub.userId} failed: ${result.error}`);
  await prisma.pushSubscription.updateMany({ where: { id: sub.id }, data: { failCount: { increment: 1 } } });
  await prisma.pushSubscription.deleteMany({ where: { id: sub.id, failCount: { gte: MAX_PUSH_FAILURES } } });
}
