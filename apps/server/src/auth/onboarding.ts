import type { Onboarding } from '@nitpilot/protocol';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { TtlCache } from '../lib/ttl-cache';
import type { PlatformReads } from '../platform/types';

/** How long GitHub's "yes, the app is installed" is kept per person. A "no" is never kept. */
export const INSTALLED_TTL_MS = 5 * 60_000;

/** The most people whose "yes" is kept at once (the oldest goes first). */
const MAX_PEOPLE = 10_000;

/** Every step done: what a person who finished setup once always reads. */
const ALL_DONE: Onboarding['steps'] = { appInstalled: true, cliConnected: true, repoLinked: true, agentStarted: true };

/**
 * The setup checklist's facts (spec §16 "Onboarding", docs/why/onboarding-facts.md): where each tick comes from.
 * - The app is installed when GitHub lists an installation of it that the person can see (`GET /user/installations`,
 *   with their own token). A yes is kept for 5 minutes, like RepoAccess's answers. A no isn't kept, so the next read
 *   (the page asks again when its window gets focus back from GitHub's install tab) sees a fresh install at once.
 *   GitHub failing, timing out or needing a new sign-in counts as no: it is logged and never fails the read.
 * - The computer is connected when the person has a CLI token nobody revoked (`npx nitpilot login` made one).
 * - A repo is linked, and the agent started, when one of those tokens remembers it from its last hello
 *   (`nitpilot start` reports its linked repos and its agent; ws/cli-hub.ts saves both on the token).
 * The first time all four hold, `User.onboardedAt` is set; from then on every step reads done without asking GitHub.
 */
export class OnboardingFacts {
  private readonly installed: TtlCache<true>;

  constructor(
    private readonly platform: Pick<PlatformReads, 'userInstallations'>,
    now: () => number = () => Date.now(),
  ) {
    this.installed = new TtlCache(INSTALLED_TTL_MS, MAX_PEOPLE, now);
  }

  async read(userId: string): Promise<Onboarding> {
    const env = getEnv();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardedAt: true } });
    const tokens = await prisma.cliToken.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { name: true, repos: true, agentId: true },
    });
    const about = { deviceName: tokens[0]?.name ?? null, appSlug: env.GITHUB_APP_SLUG, publicReposOnly: env.PUBLIC_REPOS_ONLY };
    if (user.onboardedAt) return { steps: ALL_DONE, done: true, ...about };

    const steps: Onboarding['steps'] = {
      appInstalled: await this.appInstalled(userId),
      cliConnected: tokens.length > 0,
      repoLinked: tokens.some((t) => t.repos.length > 0),
      agentStarted: tokens.some((t) => t.agentId !== null),
    };
    const done = Object.values(steps).every(Boolean);
    // Only the first read that sees it done writes the time; two at once both answer done, and one of them saves it.
    if (done) await prisma.user.updateMany({ where: { id: userId, onboardedAt: null }, data: { onboardedAt: new Date() } });
    return { steps, done, ...about };
  }

  private async appInstalled(userId: string): Promise<boolean> {
    if (this.installed.get(userId)) return true;
    try {
      const installations = await this.platform.userInstallations(userId);
      if (installations.length === 0) return false;
      this.installed.set(userId, true);
      return true;
    } catch (err) {
      // The checklist is a hint, not a gate: a GitHub hiccup (or an expired sign-in) shows the step as not done yet.
      console.warn(`[onboarding] couldn't ask GitHub for the installations of user ${userId}:`, err);
      return false;
    }
  }
}
