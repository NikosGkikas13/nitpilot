import type { CliHub } from '../ws/cli-hub';
import { LogNotifier, oneLine, type Notification, type Notifier } from './notifier';

/**
 * Notifications through the CLI (spec §16): every CLI a person has connected prints them, and shows an OS
 * notification unless `alert` is false (Web Push brought it already; see FallbackNotifier). Someone none of whose
 * CLIs took an alerting one (none online, or only sockets that are closing) gets a line in the server log.
 */
export class CliNotifier implements Notifier {
  constructor(
    private readonly hub: Pick<CliHub, 'connectionsFor'>,
    private readonly offline: Notifier = new LogNotifier(),
  ) {}

  async notify(n: Notification): Promise<{ reached: string[] }> {
    const alert = n.alert ?? true;
    const reached: string[] = [];
    const unreached: string[] = [];
    for (const userId of n.userIds) {
      let took = false;
      // Every CLI gets it. send() says false when the socket is closing, which doesn't count as reached.
      for (const cli of this.hub.connectionsFor(userId)) {
        if (cli.send({ v: 1, t: 'notify', d: { kind: n.kind, chatId: n.chatId, title: oneLine(n), url: n.url, alert } })) took = true;
      }
      if (took) reached.push(userId);
      else unreached.push(userId);
    }
    // Someone push reached (alert false) and with no CLI online was still told: nothing to log.
    if (alert && unreached.length > 0) await this.offline.notify({ ...n, userIds: unreached });
    return { reached };
  }
}
