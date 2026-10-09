import { routePrEvent, type RouterDeps } from '../chats/route-event';
import { getEnv } from '../lib/env';
import type { DeliveryHandler } from './process';
import { syncFromEvent } from './installations';

/** What happens to each stored webhook delivery: parse it, then sync installations or route PR events. */
export function createDeliveryHandler(deps: RouterDeps): DeliveryHandler {
  return async ({ deliveryId, event, body }) => {
    const payload = JSON.parse(body) as { action?: string; repository?: { private?: boolean } };
    // Hosted instance: payloads about private repos are dropped (spec §14.9). Except the one saying
    // a repo just became private: it has to get through, because it purges what we kept while it was public.
    const becamePrivate = event === 'repository' && payload.action === 'privatized';
    if (getEnv().PUBLIC_REPOS_ONLY && payload.repository?.private === true && !becamePrivate) {
      return { status: 'ignored', note: 'private repo (public-only mode)' };
    }

    const headers = new Headers({ 'x-github-event': event, 'x-github-delivery': deliveryId });
    const events = await deps.platform.parseWebhook(headers, body);
    if (events.length === 0) return { status: 'ignored', note: `nothing to do for ${event}${payload.action ? `.${payload.action}` : ''}` };

    const skipped: string[] = [];
    for (const ne of events) {
      if (ne.scope === 'pr') {
        const reason = await routePrEvent(ne, deps);
        if (reason) skipped.push(reason);
      } else {
        await syncFromEvent(ne);
      }
    }
    return skipped.length === events.length ? { status: 'ignored', note: skipped.join('; ') } : { status: 'processed' };
  };
}
