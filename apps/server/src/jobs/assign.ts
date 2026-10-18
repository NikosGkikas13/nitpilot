import { LEASE_SEC, type AgentMode, type JobBundle, type JobType } from '@nitpilot/protocol';
import { prisma } from '../lib/prisma';
import type { CliConnection, CliHub } from '../ws/cli-hub';

/**
 * The agent mode each job type needs (spec §12.2): reviews only read, address jobs edit files. A publish job runs no
 * agent (null): it goes to the device that made its draft instead (`draftDevices`).
 */
const MODE_FOR: Record<JobType, AgentMode | null> = { review: 'reviewer', re_review: 'reviewer', address: 'editor', publish: null };

/** When a lease handed out now runs out (spec §9.4: 90 seconds, renewed by every ping). */
export function leaseUntil(now: Date): Date {
  return new Date(now.getTime() + LEASE_SEC * 1000);
}

/** A job the assigner just took (it is `running`). `attempt` is the one it just started. */
export type AssignedJob = { jobId: string; chatId: string; attempt: number };
export type BundleFailedListener = (job: AssignedJob) => Promise<void>;

/**
 * Hands queued jobs to connected CLIs (spec §9.4 "Assigning a job"). There's no offer and accept:
 * each CLI's hello already said which repos it has, what its agent can do and how many jobs it
 * runs at once. Woken by ws/wire.ts. See docs/why/websockets.md.
 */
export class JobAssigner {
  private running: Promise<void> | null = null;
  private again = false;
  private readonly bundleFailedListeners: BundleFailedListener[] = [];

  constructor(
    private readonly hub: CliHub,
    private readonly buildBundle: (jobId: string) => Promise<JobBundle>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Called when a job was taken but its bundle could not be built (ws/wire.ts hands it to the engine). */
  onBundleFailed(listener: BundleFailedListener): void {
    this.bundleFailedListeners.push(listener);
  }

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
      // No cap: only users with a CLI online are looked at, and a participant has at most one active job.
      orderBy: [{ runAfter: 'asc' }, { createdAt: 'asc' }],
      include: { chat: { select: { headSha: true, repo: { select: { fullName: true } } } } },
    });
    const load = await runningPerCli(clis);
    const devices = await draftDevices(jobs);

    let assigned = 0;
    for (const job of jobs) {
      // What this CLI must be able to do: run the agent mode the job needs, or, for a publish job, be the laptop
      // whose clone holds the draft commit (spec §9.4). A publish job whose draft has no device can go nowhere.
      const mode = MODE_FOR[job.type as JobType];
      const device = job.draftOfId ? devices.get(job.draftOfId) : undefined;
      const fits = (c: CliConnection) => (mode ? c.agent.modes.includes(mode) : c.tokenId === device);
      // Pick from `clis`, the snapshot `load` was counted for, not from the hub's live list: a CLI that
      // connected mid-pass has no count here (its hello wakes the assigner, so the next pass has it). A
      // snapshot connection that was replaced or dropped since is skipped: it has a dead socket.
      const cli = clis.find(
        (c) =>
          c.userId === job.userId &&
          this.hub.connection(c.tokenId) === c &&
          c.repos.has(job.chat.repo.fullName) &&
          fits(c) &&
          (load.get(c.tokenId) ?? 0) < c.concurrency,
      );
      // No CLI can take it now (offline, repo not linked there, agent can't, not the draft's device, or busy): it waits.
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
      // The swap just added 1 to the attempt we read.
      await this.send(cli, { jobId: job.id, chatId: job.chatId, attempt: job.attempt + 1 });
    }
    return assigned;
  }

  /**
   * Build the bundle and send it. If the bundle can't be built, listeners are told (ws/wire.ts gives the
   * job back to the engine, which decides on a retry). If the CLI left before the message went out, the
   * job stays `running` with nobody working on it until its lease runs out, and then it goes back to the queue.
   */
  private async send(cli: CliConnection, job: AssignedJob): Promise<void> {
    let bundle: JobBundle;
    try {
      bundle = await this.buildBundle(job.jobId);
    } catch (err) {
      console.error(`[assign] could not build the bundle for job ${job.jobId}:`, err);
      await this.tellBundleFailed(job);
      return;
    }
    try {
      if (!cli.send({ v: 1, t: 'job.assign', d: { bundle } })) console.warn(`[assign] ${cli.login}/${cli.device} left before job ${job.jobId} reached it`);
    } catch (err) {
      console.error(`[assign] could not send job ${job.jobId}:`, err);
    }
  }

  /** A listener that throws is logged and skipped: the pass goes on. */
  private async tellBundleFailed(job: AssignedJob): Promise<void> {
    for (const listener of this.bundleFailedListeners) {
      try {
        await listener(job);
      } catch (err) {
        console.error(`[assign] bundle-failed listener failed for job ${job.jobId}:`, err);
      }
    }
  }
}

/**
 * For the publish jobs among `jobs`: the device (CLI token id) that made each one's draft, by draft job id. The
 * draft job keeps the token of the CLI that ran it, so no column of its own pins the device. One query, none without
 * publish jobs.
 */
async function draftDevices(jobs: { draftOfId: string | null }[]): Promise<Map<string, string>> {
  const ids = jobs.map((j) => j.draftOfId).filter((id): id is string => id !== null);
  if (ids.length === 0) return new Map();
  const drafts = await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, cliTokenId: true } });
  return new Map(drafts.flatMap((d) => (d.cliTokenId ? [[d.id, d.cliTokenId] as const] : [])));
}

/** How many jobs each connected CLI is running, counted in the database (the source of truth). */
async function runningPerCli(clis: CliConnection[]): Promise<Map<string, number>> {
  const rows = await prisma.job.findMany({ where: { status: 'running', cliTokenId: { in: clis.map((c) => c.tokenId) } }, select: { cliTokenId: true } });
  const load = new Map<string, number>();
  for (const { cliTokenId } of rows) if (cliTokenId) load.set(cliTokenId, (load.get(cliTokenId) ?? 0) + 1);
  return load;
}
