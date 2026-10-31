import { BRAND } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { CliError } from '../errors';
import { MAX_BODY_CHARS, recentReviewComments } from './review-comments';

const human = (login: string, body: string, n = 1) => ({
  user: { login, type: 'User' },
  path: 'src/app.ts',
  body,
  html_url: `https://github.com/acme/shop-api/pull/1#discussion_r${n}`,
  created_at: '2026-10-30T10:00:00Z',
});
const useful = 'Please return early here instead of nesting the whole block.';

/** Answers each page in turn; records the URLs asked for. */
function fakeGithub(pages: unknown[][]) {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify(pages[page - 1] ?? []), { status: 200 });
  }) as typeof fetch;
  return { impl, urls };
}

describe('recentReviewComments', () => {
  it('keeps people, and skips bots, Nitpilot and replies that say nothing', async () => {
    const gh = fakeGithub([
      [
        human('ana', `  ${useful}  `, 1),
        { ...human('dependabot[bot]', useful), user: { login: 'dependabot[bot]', type: 'User' } },
        { ...human('ci', useful), user: { login: 'ci', type: 'Bot' } },
        { ...human('ghost', useful), user: null },
        human('leo', `**P1 · major · bug:** Leaks the handle\n\nClose it in finally.`),
        human('leo', `Looks right.\n\n<!-- ${BRAND.commentMarker} chat=c1 task=t1 point=1 -->`),
        human('leo', `🤖 Review by leo's agent · ${BRAND.name}\n\nmore`),
        human('ana', '+1'),
        human('ana', 'LGTM'),
        human('ana', 'Thanks, fixed!'),
        human('ana', 'Thank you so much for this!'),
        human('sam', 'Thanks, but this still leaks the handle when the parse throws.', 2),
      ],
    ]);
    const comments = await recentReviewComments('acme/shop-api', 'tok', gh.impl);
    expect(comments).toEqual([
      { author: 'ana', path: 'src/app.ts', body: useful, url: 'https://github.com/acme/shop-api/pull/1#discussion_r1', createdAt: '2026-10-30T10:00:00Z' },
      expect.objectContaining({ author: 'sam' }),
    ]);
    expect(gh.urls).toEqual(['https://api.github.com/repos/acme/shop-api/pulls/comments?sort=created&direction=desc&per_page=100&page=1']);
  });

  it('caps each body', async () => {
    const gh = fakeGithub([[human('ana', 'word '.repeat(500))]]);
    const [c] = await recentReviewComments('acme/shop-api', 'tok', gh.impl);
    expect(c!.body).toHaveLength(MAX_BODY_CHARS);
  });

  it('reads more pages only until it has 100, and stops after 3', async () => {
    const full = (login: string) => Array.from({ length: 100 }, (_, i) => human(login, useful, i));
    const half = fakeGithub([full('dependabot[bot]').slice(0, 50).concat(full('ana').slice(0, 50)), full('sam'), full('leo')]);
    const got = await recentReviewComments('acme/shop-api', 'tok', half.impl);
    expect(got).toHaveLength(100);
    expect(got.at(-1)!.author).toBe('sam');
    expect(half.urls).toHaveLength(2);

    const bots = fakeGithub([full('a[bot]'), full('b[bot]'), full('c[bot]'), full('ana')]);
    expect(await recentReviewComments('acme/shop-api', 'tok', bots.impl)).toEqual([]);
    expect(bots.urls).toHaveLength(3);
  });

  it('refuses a repo name that could change the URL, before calling GitHub', async () => {
    const gh = fakeGithub([]);
    for (const bad of ['acme', 'acme/../x', 'acme/shop?x=1', '../shop', 'a/b/c']) {
      await expect(recentReviewComments(bad, 'tok', gh.impl)).rejects.toThrow(/isn't a repo name/);
    }
    expect(gh.urls).toEqual([]);
  });

  it('turns GitHub errors into plain messages', async () => {
    const answer = (status: number) => (async () => new Response('{}', { status })) as typeof fetch;
    await expect(recentReviewComments('acme/shop-api', 'tok', answer(401))).rejects.toThrow(/turned down your token/);
    await expect(recentReviewComments('acme/shop-api', 'tok', answer(404))).rejects.toThrow(/your token can't see it/);
    await expect(recentReviewComments('acme/shop-api', 'tok', answer(500))).rejects.toThrow(/answered 500/);
    const down = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    }) as typeof fetch;
    const err = await recentReviewComments('acme/shop-api', 'tok', down).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as Error).message).toMatch(/Couldn't reach GitHub/);
  });
});
