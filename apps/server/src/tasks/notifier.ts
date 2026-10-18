import type { NotifyKind } from '@nitpilot/protocol';

export type Notification = {
  userIds: string[];
  kind: NotifyKind;
  chatId: string;
  /** The heading, from the design handoff's push copy: "Ready for your approval", "Needs you", … */
  title: string;
  /** The detail under it: "acme/shop-api#142", "acme/shop-api#139: P1 needs a human decision". */
  body: string;
  /** The chat's page in the web app. */
  url: string;
  /**
   * False when Web Push already brought this notification to these people: their CLI prints it but shows no OS
   * notification (spec §16). Left out, it alerts.
   */
  alert?: boolean;
};

/** A notification as one line: what the CLI prints (and Plan 1 showed), "Ready for your approval: acme/shop-api#142". */
export function oneLine(n: Pick<Notification, 'title' | 'body'>): string {
  return `${n.title}: ${n.body}`;
}

export interface Notifier {
  /** Tell these people. Answers who it reached: someone it couldn't get to isn't in `reached`. */
  notify(n: Notification): Promise<{ reached: string[] }>;
}

/** Writes notifications to the server log, for people nothing else reached. A log line reaches nobody. */
export class LogNotifier implements Notifier {
  async notify(n: Notification): Promise<{ reached: string[] }> {
    console.log(`[notify] ${n.kind} → ${n.userIds.join(', ')}: ${oneLine(n)} (${n.url})`);
    return { reached: [] };
  }
}

/**
 * Push first, the CLI as fallback (spec §16, docs/why/web-push.md). The primary (Web Push) goes first. Then every
 * person gets the fallback (their CLI) too, since the CLI's terminal line is always printed, but only the people the
 * primary didn't reach get it with `alert` on (the CLI's OS notification). So each person gets one alerting ping:
 * a push, or the CLI's notification when no push of theirs arrived.
 */
export class FallbackNotifier implements Notifier {
  constructor(
    private readonly primary: Notifier,
    private readonly fallback: Notifier,
  ) {}

  async notify(n: Notification): Promise<{ reached: string[] }> {
    const pushed = new Set((await this.primary.notify(n)).reached);
    const quiet = n.userIds.filter((id) => pushed.has(id));
    const loud = n.userIds.filter((id) => !pushed.has(id));
    const reached = new Set(pushed);
    if (quiet.length > 0) await this.fallback.notify({ ...n, userIds: quiet, alert: false });
    if (loud.length > 0) {
      for (const id of (await this.fallback.notify({ ...n, userIds: loud, alert: true })).reached) reached.add(id);
    }
    return { reached: [...reached] };
  }
}
