import { routePrEvent, type RouterDeps } from '../chats/route-event';
import { prisma } from '../lib/prisma';
import type { FoundPr } from '../platform/types';

/**
 * Catching up when a CLI connects (spec §15): webhooks GitHub sent while the server was down, or
 * before the app could see a repo, never arrive again. So the first time a person's CLI says hello
 * after the server starts, search for their open PRs, and start each one Nitpilot has no chat for as if
 * it had just been opened. Once per person per server start: it's a catch-up, not polling.
 */
export class CatchUp {
  private readonly done = new Set<string>();
  private readonly running = new Map<string, Promise<number>>();

  constructor(private readonly deps: RouterDeps) {}

  /**
   * Catch this person up, unless that already happened since the server started. Resolves with how many
   * chats it started. A failed search rejects and isn't remembered, so their next hello tries again.
   */
  forUser(user: { id: string; login: string }): Promise<number> {
    if (this.done.has(user.id)) return Promise.resolve(0);
    // Two of their CLIs saying hello at once share one catch-up.
    let run = this.running.get(user.id);
    if (!run) {
      run = this.run(user).finally(() => this.running.delete(user.id));
      this.running.set(user.id, run);
    }
    return run;
  }

  private async run(user: { id: string; login: string }): Promise<number> {
    const found = await this.deps.platform.findOpenPrsFor(user);
    this.done.add(user.id);
    let started = 0;
    for (const pr of found) {
      try {
        if (await this.start(pr)) started += 1;
      } catch (err) {
        // One PR that can't be read (deleted a moment ago, say) doesn't stop the others.
        console.error(`[catch-up] ${pr.repoFullName}#${pr.number}:`, err);
      }
    }
    return started;
  }

  /** Start a chat for this PR if Nitpilot has none and it's still open. True when one was started. */
  private async start(pr: FoundPr): Promise<boolean> {
    // A repo the app isn't installed on (or that it lost) is none of our business.
    const repo = await prisma.repo.findUnique({ where: { fullName: pr.repoFullName } });
    if (!repo) return false;
    if ((await prisma.prChat.count({ where: { repoId: repo.id, number: pr.number } })) > 0) return false;
    const ref = { installationId: repo.installationId, repoId: repo.id, repoFullName: repo.fullName, number: pr.number };
    const snapshot = await this.deps.platform.getPr(ref);
    if (snapshot.state !== 'open') return false;
    const event = { type: 'pr_opened' as const, author: snapshot.author, reviewers: snapshot.requestedReviewers };
    return (await routePrEvent({ scope: 'pr', pr: ref, snapshot, event }, this.deps)) === null;
  }
}
