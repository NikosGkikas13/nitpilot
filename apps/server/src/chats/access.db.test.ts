import { describe, expect, it } from 'vitest';
import { makeChat, makeGithubSignIn, makeRepo, makeUser } from '../../test/db';
import { fakeFetch, json } from '../../test/fake-fetch';
import { RepoAccess } from '../auth/repo-access';
import { GithubClient } from '../platform/github/client';
import { chatAccess, chatAccessByPath } from './access';

async function viewer(status: 'ok' | 'needs_reauth' = 'ok') {
  const user = await makeUser();
  await makeGithubSignIn(user.id, status);
  return user;
}

describe('chatAccess (spec §16 "Who can see a chat")', () => {
  it("lets in anyone GitHub shows the repo to, and says none for a hidden repo or a chat that doesn't exist", async () => {
    const [open, hidden] = [await makeRepo(), await makeRepo()];
    const [a, b] = [await makeChat(open.id), await makeChat(hidden.id)];
    const fetch = fakeFetch({ [`GET /repos/${open.fullName}`]: () => ({ id: 1 }), [`GET /repos/${hidden.fullName}`]: () => json({ message: 'Not Found' }, 404) });
    const access = new RepoAccess(new GithubClient(fetch));
    const user = await viewer();
    expect(await chatAccess(user, a.id, access)).toEqual({ kind: 'read', chat: { id: a.id, repoFullName: open.fullName } });
    expect(await chatAccess(user, b.id, access)).toEqual({ kind: 'none' });
    const calls = fetch.calls.length;
    expect(await chatAccess(user, 'no-such-chat', access)).toEqual({ kind: 'none' });
    expect(fetch.calls).toHaveLength(calls);
  });

  it('says reauth when your GitHub sign-in expired', async () => {
    const repo = await makeRepo();
    const chat = await makeChat(repo.id);
    const access = new RepoAccess(new GithubClient(fakeFetch({})));
    expect(await chatAccess(await viewer('needs_reauth'), chat.id, access)).toEqual({ kind: 'reauth' });
  });

  it("says reauth for a chat that doesn't exist too, so an expired sign-in can't tell which ids exist", async () => {
    const access = new RepoAccess(new GithubClient(fakeFetch({})));
    expect(await chatAccess(await viewer('needs_reauth'), 'no-such-chat', access)).toEqual({ kind: 'reauth' });
  });
});

describe('chatAccessByPath', () => {
  it('takes only plain digits for the PR number, without asking GitHub', async () => {
    const fetch = fakeFetch({});
    const access = new RepoAccess(new GithubClient(fetch));
    const user = await viewer();
    for (const number of ['1e2', '0x2a', ' 42', '42.0', '-1', '0', '']) {
      expect(await chatAccessByPath(user, { owner: 'octo', repo: 'sandbox', number }, access)).toEqual({ kind: 'none' });
    }
    expect(fetch.calls).toEqual([]);
  });
});
