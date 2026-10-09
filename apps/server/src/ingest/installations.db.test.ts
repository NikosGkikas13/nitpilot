import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, resetDb } from '../../test/db';
import { prisma } from '../lib/prisma';
import { syncFromEvent } from './installations';

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const repo = (id: string, fullName: string, isPrivate = false) => ({ id, fullName, private: isPrivate, defaultBranch: 'main' });

describe('syncFromEvent', () => {
  it('creates an installation and its repos, then follows additions and removals', async () => {
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo('501', 'octo/a')] });
    await syncFromEvent({ scope: 'installation_repos', installationId: '77', accountLogin: 'octo', added: [repo('502', 'octo/b')], removed: ['501'] });
    expect((await prisma.repo.findMany({ orderBy: { id: 'asc' } })).map((r) => r.fullName)).toEqual(['octo/b']);
  });

  it('records suspension and lifts it', async () => {
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [] });
    await syncFromEvent({ scope: 'installation', action: 'suspend', installationId: '77', accountLogin: 'octo', repos: [] });
    expect((await prisma.installation.findUniqueOrThrow({ where: { id: '77' } })).suspendedAt).not.toBeNull();
    await syncFromEvent({ scope: 'installation', action: 'unsuspend', installationId: '77', accountLogin: 'octo', repos: [] });
    expect((await prisma.installation.findUniqueOrThrow({ where: { id: '77' } })).suspendedAt).toBeNull();
  });

  it('deletes everything when the app is uninstalled', async () => {
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo('501', 'octo/a')] });
    await makeChat('501');
    await syncFromEvent({ scope: 'installation', action: 'deleted', installationId: '77', accountLogin: 'octo', repos: [] });
    expect(await prisma.prChat.count()).toBe(0);
  });

  it('purges chats of a repo made private, in public-only mode', async () => {
    vi.stubEnv('PUBLIC_REPOS_ONLY', 'true');
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo('501', 'octo/a')] });
    await makeChat('501');
    await syncFromEvent({ scope: 'repo', action: 'privatized', installationId: '77', repo: repo('501', 'octo/a', true) });
    expect(await prisma.prChat.count()).toBe(0);
    expect((await prisma.repo.findUniqueOrThrow({ where: { id: '501' } })).private).toBe(true);
  });

  it('keeps chats of a repo made private on a self-hosted instance', async () => {
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo('501', 'octo/a')] });
    await makeChat('501');
    await syncFromEvent({ scope: 'repo', action: 'privatized', installationId: '77', repo: repo('501', 'octo/a', true) });
    expect(await prisma.prChat.count()).toBe(1);
  });
});
