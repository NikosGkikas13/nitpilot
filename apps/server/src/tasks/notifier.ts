import type { NotifyKind } from '@nitpilot/protocol';

export type Notification = { userIds: string[]; kind: NotifyKind; chatId: string; title: string; url: string };

export interface Notifier {
  notify(n: Notification): Promise<void>;
}

/** Plan 1a writes notifications to the server log. Plan 1b sends them to each user's CLI. */
export class LogNotifier implements Notifier {
  async notify(n: Notification): Promise<void> {
    console.log(`[notify] ${n.kind} → ${n.userIds.join(', ')}: ${n.title} (${n.url})`);
  }
}
