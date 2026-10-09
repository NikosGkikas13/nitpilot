import type { AnchoredComment, PlatformAdapter, PrRef, WriteOptions } from '../types';
import type { AppAuth } from './app-auth';
import type { GithubClient } from './client';
import { GithubReads } from './reads';
import { postReview, replyToThread, upsertSummary, type WriteContext } from './writes';

/** The complete GitHub adapter (spec §12.1): reads, webhook parsing and writes. */
export class GithubPlatform extends GithubReads implements PlatformAdapter {
  private readonly writeCtx: WriteContext;

  constructor(github: GithubClient, appAuth: AppAuth, userToken: (userId: string) => Promise<string>) {
    super(github, appAuth);
    this.writeCtx = { github, appAuth, userToken };
  }

  upsertSummary(pr: PrRef, body: string, existingId?: string, opts?: WriteOptions) {
    return upsertSummary(this.writeCtx, pr, body, existingId, opts);
  }

  postReview(asUser: string, pr: PrRef, r: { commitSha: string; body: string; comments: AnchoredComment[] }, opts?: WriteOptions) {
    return postReview(this.writeCtx, asUser, pr, r, opts);
  }

  replyToThread(asUser: string, pr: PrRef, threadRootId: string, body: string, opts?: WriteOptions) {
    return replyToThread(this.writeCtx, asUser, pr, threadRootId, body, opts);
  }

  /**
   * Ask GitHub to resend deliveries that failed since `since` and never succeeded on a later
   * attempt (spec §15). Looks at the most recent 100 deliveries.
   */
  async redeliverFailed(since: Date): Promise<number> {
    type Delivery = { id: string; guid: string; status_code: number; delivered_at: string };
    const token = this.appAuth.jwt();
    // Delivery ids are 64-bit and JSON.parse would round them, so read the text and keep ids as strings.
    const { data: text } = await this.github.api<string>('GET', '/app/hook/deliveries?per_page=100', { token, raw: true });
    const data = JSON.parse(idsAsStrings(text)) as Delivery[];
    const ok = (d: Delivery) => d.status_code >= 200 && d.status_code < 300;
    const succeeded = new Set(data.filter(ok).map((d) => d.guid));
    let count = 0;
    for (const d of data) {
      if (ok(d) || succeeded.has(d.guid) || new Date(d.delivered_at) < since) continue;
      await this.github.api('POST', `/app/hook/deliveries/${d.id}/attempts`, { token });
      succeeded.add(d.guid); // one redelivery per delivery
      count += 1;
    }
    return count;
  }
}

/**
 * Rewrite `"id": 3847008565046804567` as `"id": "3847008565046804567"` before JSON.parse.
 * Only object keys match (right after `{` or `,`), never text inside a string value.
 */
function idsAsStrings(json: string): string {
  return json.replace(/([{,]\s*)"id"\s*:\s*(\d+)/g, '$1"id":"$2"');
}
