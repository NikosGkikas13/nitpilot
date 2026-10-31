import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { testApp } from '../../test/app';
import { makeChat, makeRepo } from '../../test/db';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';

let dist: string;
beforeAll(() => {
  dist = mkdtempSync(path.join(tmpdir(), 'nitpilot-preview-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>app</title></head></html>');
});
afterAll(() => rmSync(dist, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

/** A chat with 3 points, in round 2 and ready, its page served by the real app with a fake GitHub. */
async function scene(repoOver: Parameters<typeof makeRepo>[0] = {}) {
  const repo = await makeRepo(repoOver);
  const chat = await makeChat(repo.id);
  await prisma.prChat.update({ where: { id: chat.id }, data: { title: 'Fix "login" <b>now</b>', phase: 'ready', round: 2 } });
  await prisma.point.createMany({
    data: [1, 2, 3].map((number) => ({ chatId: chat.id, number, raisedByGithubId: '1', origin: 'agent', severity: 'minor', category: 'bug', title: 't', body: 'b', round: 1 })),
  });
  const platform = new FakePlatform();
  const isRepoPublic = vi.spyOn(platform, 'isRepoPublic');
  const app = testApp({ platform, webDistDir: dist });
  const page = async (url = `/c/${repo.fullName}/${chat.number}`) => (await app.request(url)).text();
  return { repo, chat, platform, isRepoPublic, app, page };
}

describe('preview card on a shared chat link (spec §16)', () => {
  it("fills the card for a public repo's chat, escaped", async () => {
    const { repo, chat, page } = await scene();
    const html = await page();
    expect(html).toContain(`<meta property="og:title" content="Fix &quot;login&quot; &lt;b&gt;now&lt;/b&gt; · ${repo.fullName}#${chat.number}">`);
    expect(html).toContain('<meta property="og:description" content="3 points · 2 rounds · ready to approve">');
    expect(html).toContain(`<meta property="og:url" content="http://localhost:8787/c/${repo.fullName}/${chat.number}">`);
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it('shows nothing for a private repo, one GitHub now says is private, public_chats: false, or a missing chat', async () => {
    const stored = await scene({ private: true });
    const nowPrivate = await scene();
    nowPrivate.platform.privateRepos.add(nowPrivate.repo.fullName);
    const optedOut = await scene({ rulesJson: { public_chats: false } });
    const missing = await scene();
    const pages = [await stored.page(), await nowPrivate.page(), await optedOut.page(), await missing.page(`/c/${missing.repo.fullName}/9999`)];
    for (const html of pages) {
      expect(html).toContain('<meta name="robots" content="noindex">');
      expect(html).not.toContain('og:');
      expect(html).not.toContain('login');
    }
  });

  it('shares one "is it public?" cache with the no-sign-in chat route', async () => {
    const { repo, chat, app, page, isRepoPublic } = await scene();
    await page();
    expect((await app.request(`/api/public/chats/${repo.fullName}/${chat.number}`)).status).toBe(200);
    await page();
    expect(isRepoPublic).toHaveBeenCalledTimes(1);
  });
});
