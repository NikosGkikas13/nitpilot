import type { CliHub } from '../ws/cli-hub';
import { LogNotifier, type Notification, type Notifier } from './notifier';

/**
 * Plan 1's notifications (spec §16): every CLI a person has connected prints them and shows an OS
 * notification. Someone with no CLI online only gets a line in the server log; Plan 2 adds Web Push.
 */
export class CliNotifier implements Notifier {
  constructor(
    private readonly hub: CliHub,
    private readonly offline: Notifier = new LogNotifier(),
  ) {}

  async notify(n: Notification): Promise<void> {
    const unreached: string[] = [];
    for (const userId of n.userIds) {
      const clis = this.hub.connectionsFor(userId);
      for (const cli of clis) cli.send({ v: 1, t: 'notify', d: { kind: n.kind, chatId: n.chatId, title: n.title, url: n.url } });
      if (clis.length === 0) unreached.push(userId);
    }
    if (unreached.length > 0) await this.offline.notify({ ...n, userIds: unreached });
  }
}
