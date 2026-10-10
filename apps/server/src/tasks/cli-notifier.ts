import type { CliHub } from '../ws/cli-hub';
import { LogNotifier, type Notification, type Notifier } from './notifier';

/**
 * Plan 1's notifications (spec §16): every CLI a person has connected prints them and shows an OS
 * notification. Someone none of whose CLIs took it (none online, or only sockets that are closing)
 * only gets a line in the server log; Plan 2 adds Web Push.
 */
export class CliNotifier implements Notifier {
  constructor(
    private readonly hub: Pick<CliHub, 'connectionsFor'>,
    private readonly offline: Notifier = new LogNotifier(),
  ) {}

  async notify(n: Notification): Promise<void> {
    const unreached: string[] = [];
    for (const userId of n.userIds) {
      let reached = false;
      // Every CLI gets it. send() says false when the socket is closing, which doesn't count as reached.
      for (const cli of this.hub.connectionsFor(userId)) {
        if (cli.send({ v: 1, t: 'notify', d: { kind: n.kind, chatId: n.chatId, title: n.title, url: n.url } })) reached = true;
      }
      if (!reached) unreached.push(userId);
    }
    if (unreached.length > 0) await this.offline.notify({ ...n, userIds: unreached });
  }
}
