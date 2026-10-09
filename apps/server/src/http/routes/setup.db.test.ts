import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeUser, resetDb } from '../../../test/db';
import { fakeFetch } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { prisma } from '../../lib/prisma';
import { AppAuth } from '../../platform/github/app-auth';
import { GithubClient } from '../../platform/github/client';

beforeEach(resetDb);

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

describe('GET /github/setup', () => {
  it('syncs the new installation from the API, then goes home', async () => {
    const github = new GithubClient(
      fakeFetch({
        'GET /app/installations/77': () => ({ id: 77, account: { login: 'octo' } }),
        'POST /app/installations/77/access_tokens': () => ({ token: 'ghs_x', expires_at: '2099-01-01T00:00:00Z' }),
        'GET /installation/repositories': () => ({ repositories: [{ id: 501, full_name: 'octo/sandbox', private: false, default_branch: 'main' }] }),
      }),
    );
    const user = await makeUser();
    const res = await testApp({ github, appAuth: new AppAuth(github, '12345', pem) }).request('/github/setup?installation_id=77&setup_action=install', {
      headers: { cookie: await sessionCookieFor(user.id) },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect((await prisma.repo.findUniqueOrThrow({ where: { id: '501' } })).fullName).toBe('octo/sandbox');
  });

  it('asks people who are not signed in to sign in first', async () => {
    const res = await testApp().request('/github/setup?installation_id=77');
    expect(res.headers.get('location')).toBe(`/auth/github/login?next=${encodeURIComponent('/github/setup?installation_id=77')}`);
  });
});
