import { LEASE_SEC, type AgentMode, type JobBundle, type JobType } from '@nitpilot/protocol';
import { prisma } from '../lib/prisma';
import type { CliConnection, CliHub } from '../ws/cli-hub';

/** The agent mode each job type needs (spec §12.2): reviews only read, address jobs edit files. */
const MODE_FOR: Record<JobType, AgentMode> = { review: 'reviewer', re_review: 'reviewer', address: 'editor' };

/** When a lease handed out now runs out (spec §9.4: 90 seconds, renewed by every ping). */
export function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + LEASE_SEC * 1000);
}

/**
 * Hands queued jobs to connected CLIs (spec §9.4 "Assigning a job"). There's no offer and accept:
 * each CLI's hello already said which repos it has, what its agent can do and how many jobs it
 * runs at once. Woken by ws/wire.ts. See docs/why/websockets.md.
 */
export class JobAssigner {
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly hub: CliHub,
    private readonly buildBundle: (jobId: string) => Promise<JobBundle>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Assign soon, without waiting for it. */
  wake(): void {
    void this.tick();
  }

  /**
   * Run passes until nothing new came in. Never two at once: a call during a pass asks for one more
   * pass, so a CLI can't be given two jobs by two passes that each saw it free. Resolves when idle.
   */
  tick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.runPasses();
    return this.running;
  }

  private async runPasses(): Promise<void> {
    try {
      do {
        this.again = false;
        await this.assignDue();
      } while (this.again);
    } catch (err) {
      console.error('[assign] pass failed:', err);
    } finally {
      this.running = null;
    }
  }

  /** One pass: give each due job to a CLI that can take it. Returns how many went out. */
  async assignDue(): Promise<number> {
    const clis = this.hub.connections();
    if (clis.length === 0) return 0;
    const now = this.now();
    const jobs = await prisma.job.findMany({
      where: { status: 'queued', runAfter: { lte: now }, userId: { in: [...new Set(clis.map((c) => c.userId))] } },
      orderBy: [{ runAfter: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      include: { chat: { select: { headSha: true, repo: { select: { fullName: true } } } } },
    });
    const load = await runningPerCli(clis);

    let assigned = 0;
    for (const job of jobs) {
      const mode = MODE_FOR[job.type as JobType];
      const cli = this.hub.connectionsFor(job.userId).find(
        (c) => c.repos.has(job.chat.repo.fullName) && c.agent.modes.includes(mode) && (load.get(c.tokenId) ?? 0) < c.concurrency,
      );
      // No CLI can take it now (offline, repo not linked there, agent can't, or busy): it waits.
      if (!cli) continue;
      // Compare-and-swap: only a job that is still queued can be taken, so it goes out once. A queued
      // job follows the PR's latest head; once running it stays on that commit (spec §9.4).
      const { count } = await prisma.job.updateMany({
        where: { id: job.id, status: 'queued' },
        data: { status: 'running', attempt: { increment: 1 }, cliTokenId: cli.tokenId, leaseExpiresAt: leaseUntil(now), headSha: job.chat.headSha },
      });
      if (count === 0) continue; // cancelled or taken meanwhile
      load.set(cli.tokenId, (load.get(cli.tokenId) ?? 0) + 1);
      assigned += 1;
      await this.send(cli, job.id);
    }
    return assigned;
  }

  /**
   * Send the job to its CLI. If that fails, the job stays `running` with nobody working on it until
   * its lease runs out, and then it goes back to the queue.
   */
  private async send(cli: CliConnection, jobId: string): Promise<void> {
    try {
      const bundle = await this.buildBundle(jobId);
      if (!cli.send({ v: 1, t: 'job.assign', d: { bundle } })) console.warn(`[assign] ${cli.login}/${cli.device} left before job ${jobId} reached it`);
    } catch (err) {
      console.error(`[assign] could not send job ${jobId}:`, err);
    }
  }
}

/** How many jobs each connected CLI is running, counted in the database (the source of truth). */
async function runningPerCli(clis: CliConnection[]): Promise<Map<string, number>> {
  const rows = await prisma.job.findMany({ where: { status: 'running', cliTokenId: { in: clis.map((c) => c.tokenId) } }, select: { cliTokenId: true } });
  const load = new Map<string, number>();
  for (const { cliTokenId } of rows) if (cliTokenId) load.set(cliTokenId, (load.get(cliTokenId) ?? 0) + 1);
  return load;
}
