import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCliToken, makeUser } from '../../test/db';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';
import { INSTALLED_TTL_MS, OnboardingFacts } from './onboarding';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The checklist's facts for a new person, with GitHub played by FakePlatform and a clock the test moves. */
async function scene() {
  const user = await makeUser({ login: 'maya' });
  const platform = new FakePlatform();
  let now = Date.now();
  const facts = new OnboardingFacts(platform, () => now);
  return {
    user,
    platform,
    read: () => facts.read(user.id),
    later: (ms: number) => void (now += ms),
    installed: () => platform.userInstalls.set(user.id, [{ id: '77', accountLogin: 'maya' }]),
  };
}

/** One of her CLI tokens, as its last hello left it. */
async function computer(userId: string, over: { name?: string; repos?: string[]; agentId?: string; revoked?: boolean } = {}) {
  const token = await makeCliToken(userId, { revoked: over.revoked ?? false });
  await prisma.cliToken.update({ where: { id: token.id }, data: { name: over.name ?? 'test laptop', repos: over.repos ?? [], agentId: over.agentId ?? null } });
  return token;
}

const NONE = { appInstalled: false, cliConnected: false, repoLinked: false, agentStarted: false };

describe('OnboardingFacts (spec §16 "Onboarding")', () => {
  it('has only the sign-in done for someone new, and names the app to install', async () => {
    const { read } = await scene();
    expect(await read()).toEqual({ steps: NONE, done: false, deviceName: null, appSlug: 'nitpilot-dev', publicReposOnly: false });
  });

  it("ticks the app off once GitHub lists an installation the person's own token can see", async () => {
    const { user, platform, read, installed } = await scene();
    installed();
    expect((await read()).steps).toEqual({ ...NONE, appInstalled: true });
    expect(platform.installationLookups).toEqual([user.id]);
  });

  it('ticks the computer off with a CLI token, named after the newest one; a revoked token does not count', async () => {
    const { user, read } = await scene();
    await computer(user.id, { name: 'old-desk', revoked: true, repos: ['octo/sandbox'], agentId: 'claude-code' });
    expect(await read()).toMatchObject({ steps: NONE, deviceName: null });
    await computer(user.id, { name: 'maya-linux-desk' });
    await computer(user.id, { name: "Maya's MacBook Pro" });
    expect(await read()).toMatchObject({ steps: { ...NONE, cliConnected: true }, deviceName: "Maya's MacBook Pro" });
  });

  it('ticks the repo off when a CLI reported a linked repo, and the agent when one reported an agent it can run', async () => {
    const { user, read } = await scene();
    await computer(user.id, { repos: ['octo/sandbox'] });
    expect((await read()).steps).toEqual({ ...NONE, cliConnected: true, repoLinked: true });
    await computer(user.id, { agentId: 'claude-code' });
    expect((await read()).steps).toEqual({ ...NONE, cliConnected: true, repoLinked: true, agentStarted: true });
  });

  it("keeps GitHub's yes for 5 minutes, then asks again", async () => {
    const { platform, read, later, installed } = await scene();
    installed();
    expect((await read()).steps.appInstalled).toBe(true);
    platform.userInstalls.clear();
    later(INSTALLED_TTL_MS - 1);
    expect((await read()).steps.appInstalled).toBe(true);
    expect(platform.installationLookups).toHaveLength(1);
    later(1);
    expect((await read()).steps.appInstalled).toBe(false);
    expect(platform.installationLookups).toHaveLength(2);
  });

  it("never keeps a no: the next read (the window's focus after GitHub's install tab) asks again", async () => {
    const { platform, read, installed } = await scene();
    expect((await read()).steps.appInstalled).toBe(false);
    installed();
    expect((await read()).steps.appInstalled).toBe(true);
    expect(platform.installationLookups).toHaveLength(2);
  });

  it('counts a GitHub failure as not installed, says so in the log, and still answers', async () => {
    const { user, platform, read } = await scene();
    platform.failUserInstallations = new Error('GitHub GET /user/installations failed with 502');
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await computer(user.id);
    expect((await read()).steps).toEqual({ ...NONE, cliConnected: true });
    expect(log).toHaveBeenCalledWith(expect.stringContaining(user.id), expect.any(Error));
  });

  it('remembers done the first time every step holds, and from then on answers done without asking GitHub', async () => {
    const { user, platform, read, installed } = await scene();
    installed();
    const token = await computer(user.id, { name: "Maya's MacBook Pro", repos: ['octo/sandbox'], agentId: 'claude-code' });
    expect(await read()).toMatchObject({ steps: { appInstalled: true, cliConnected: true, repoLinked: true, agentStarted: true }, done: true });
    const { onboardedAt } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(onboardedAt).toBeInstanceOf(Date);

    // The computer is revoked and GitHub would say no now: setup stays done.
    await prisma.cliToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
    platform.userInstalls.clear();
    expect(await read()).toMatchObject({ steps: { appInstalled: true, cliConnected: true, repoLinked: true, agentStarted: true }, done: true, deviceName: null });
    expect(platform.installationLookups).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).onboardedAt).toEqual(onboardedAt);
  });

  it('says when this server reviews public repos only', async () => {
    vi.stubEnv('PUBLIC_REPOS_ONLY', 'true');
    const { read } = await scene();
    expect((await read()).publicReposOnly).toBe(true);
  });
});
