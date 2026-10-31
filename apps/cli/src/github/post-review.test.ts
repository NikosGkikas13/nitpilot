import type { NewPoint } from '@nitpilot/protocol';
import { jobBundle, jobResult } from '@nitpilot/protocol/test-samples';
import { describe, expect, it } from 'vitest';
import { CliError } from '../errors';
import { postReview, reviewRequest, type ReviewRequest } from './post-review';

const bundle = jobBundle(); // you: leo, author: maya, acme/shop-api#142
const onLine = jobResult().points[0]!; // src/orders/list.ts:48
const prWide: NewPoint = { path: null, line: null, side: null, severity: 'nit', category: 'docs', title: 'Mention it in the README', body: 'Readers look there first.', snippet: null };

describe('reviewRequest', () => {
  it('puts points on a line inline and the rest in the body, as one COMMENT review on the head commit', () => {
    const r = reviewRequest(bundle, [onLine, prWide]);
    expect(r.event).toBe('COMMENT');
    expect(r.commit_id).toBe(bundle.pr.headSha);
    expect(r.comments).toEqual([
      { path: 'src/orders/list.ts', line: 48, side: 'RIGHT', body: '**P1 · major · bug:** `parseOrder` crashes on empty input\n\nWhen `items` is empty, `items[0].id` throws.' },
    ]);
    expect(r.body).toMatch(/^🤖 Review by leo's agent · Nitpilot\n\n\*\*P2 · nit · docs:\*\* Mention it in the README\n\nReaders look there first\.\n\n<sub>/);
    expect(r.body).toContain('[get your own agent reviewer](https://nitpilot.dev)');
  });

  it('can put every point in the body', () => {
    const r = reviewRequest(bundle, [onLine, prWide], { allInBody: true });
    expect(r.comments).toEqual([]);
    expect(r.body).toContain('**P1 · major · bug:**');
    expect(r.body).toContain('**P2 · nit · docs:**');
  });

  it("cleans what the agent wrote: only the author and you may be mentioned, and secrets don't get out", () => {
    const sneaky = { ...prWide, body: 'Ask @maya, @leo and @everyone-else. Token: ghp_' + 'a'.repeat(36) };
    const body = reviewRequest(bundle, [sneaky]).body;
    expect(body).toContain('@maya');
    expect(body).toContain('@leo');
    expect(body).not.toMatch(/(?<!\w)@everyone-else/);
    expect(body).toContain('[redacted]');
  });
});

describe('postReview', () => {
  function fakeGithub(statuses: number[]) {
    const sent: ReviewRequest[] = [];
    const impl = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string) as ReviewRequest);
      const status = statuses[sent.length - 1]!;
      return new Response(JSON.stringify({ html_url: 'https://github.com/acme/shop-api/pull/142#pullrequestreview-1' }), { status });
    }) as typeof fetch;
    return { impl, sent };
  }

  it('posts the review and returns its address', async () => {
    const gh = fakeGithub([200]);
    expect(await postReview(bundle, [onLine], 'tok', gh.impl)).toBe('https://github.com/acme/shop-api/pull/142#pullrequestreview-1');
    expect(gh.sent).toHaveLength(1);
  });

  it("moves every point into the body when GitHub won't take a comment on a line outside the diff", async () => {
    const gh = fakeGithub([422, 200]);
    await postReview(bundle, [onLine], 'tok', gh.impl);
    expect(gh.sent.map((r) => r.comments.length)).toEqual([1, 0]);
  });

  it('says so when GitHub refuses it', async () => {
    const gh = fakeGithub([403]);
    await expect(postReview(bundle, [onLine], 'tok', gh.impl)).rejects.toThrow(CliError);
    await expect(postReview(bundle, [onLine], 'tok', fakeGithub([404]).impl)).rejects.toThrow(/not be allowed to review/);
  });
});
