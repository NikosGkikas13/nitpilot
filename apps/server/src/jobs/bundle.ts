import { AgentJobBundle, JobResult, PublishBundle, type JobBundle, type JobType } from '@nitpilot/protocol';
import { prRefOf } from '../chats/refs';
import { rulesFromJson } from '../chats/rules';
import { prisma } from '../lib/prisma';
import type { PlatformReads } from '../platform/types';

/**
 * What the assigner sends for a job (spec §10 `job.assign`): a publish bundle for a publish job, an agent bundle
 * otherwise. The assigner already has the job's `type`, so it passes it in.
 */
export async function bundleFor(jobId: string, type: JobType, platform: Pick<PlatformReads, 'gitSpec'>): Promise<JobBundle> {
  return type === 'publish' ? buildPublishBundle(jobId, platform) : buildJobBundle(jobId, platform);
}

/**
 * Everything the CLI needs to run one agent job, in one message (spec §10 `job.assign`): the PR, how to
 * fetch its code, the points with their threads, the human notes and the team rules. It's built
 * right after the job was assigned, so `attempt` and `headSha` are the ones the CLI must use.
 */
export async function buildJobBundle(jobId: string, platform: Pick<PlatformReads, 'gitSpec'>): Promise<AgentJobBundle> {
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      participant: true,
      chat: {
        include: {
          repo: true,
          participants: true,
          points: { orderBy: { number: 'asc' } },
          // Point threads and human notes. System messages are for people, not agents.
          messages: { where: { OR: [{ pointNumber: { not: null } }, { kind: 'human' }] }, orderBy: { seq: 'asc' } },
        },
      },
    },
  });
  const { chat } = job;
  const rules = rulesFromJson(chat.repo.rulesJson);

  // People are stored by GitHub id; agents read logins.
  const logins = new Map(chat.participants.map((p) => [p.githubId, p.login]));
  for (const m of chat.messages) if (m.authorGithubId && m.authorLogin) logins.set(m.authorGithubId, m.authorLogin);
  const loginOf = (githubId: string) => logins.get(githubId) ?? githubId;

  // parse() checks every enum the database stores as a plain string, so a bad row fails here, not in the CLI.
  return AgentJobBundle.parse({
    jobId: job.id,
    attempt: job.attempt,
    type: job.type,
    round: job.round,
    maxRounds: rules.max_rounds + chat.extraRounds,
    apply: job.applyState === 'draft' ? 'draft' : 'auto',
    you: { login: job.participant.login, githubId: job.participant.githubId, role: job.participant.role },
    pr: {
      repoFullName: chat.repo.fullName,
      number: chat.number,
      title: chat.title,
      body: chat.body,
      url: chat.url,
      authorLogin: loginOf(chat.authorGithubId),
      baseRef: chat.baseRef,
      headRef: chat.headRef,
      baseSha: chat.baseSha,
      headSha: job.headSha,
    },
    git: platform.gitSpec({ ref: prRefOf(chat), headRef: chat.headRef, headRepoFullName: chat.headRepoFullName }),
    sinceSha: job.sinceSha,
    points: chat.points.map((p) => ({
      number: p.number,
      origin: p.origin,
      raisedBy: loginOf(p.raisedByGithubId),
      path: p.path,
      line: p.line,
      side: p.side,
      severity: p.severity,
      category: p.category,
      title: p.title,
      body: p.body,
      status: p.status,
      authorResolution: p.authorResolution,
      round: p.round,
      trusted: p.trusted,
      // The point itself is its first message; the thread is everything said about it after that.
      thread: chat.messages
        .filter((m) => m.pointNumber === p.number && m.kind !== 'point_raised')
        .map((m) => ({ author: m.authorLogin ?? 'system', kind: m.kind, body: m.body, at: m.createdAt.toISOString() })),
    })),
    notes: chat.messages
      .filter((m) => m.kind === 'human' && m.pointNumber === null)
      .map((m) => ({
        author: m.authorLogin ?? 'unknown',
        // Only system events have no author id, and those are never `human` notes; '' matches nobody, so it is never trusted.
        authorGithubId: m.authorGithubId ?? '',
        body: m.body,
        at: m.createdAt.toISOString(),
      })),
    rules: { ignorePaths: rules.ignore_paths, alwaysEscalate: rules.always_escalate, maxPoints: rules.max_points_per_review },
  });
}

/**
 * What the CLI needs to push an author's drafted fixes (spec §11 "Publish jobs"): the draft commit, which stays in that
 * laptop's clone at `refs/nitpilot/drafts/<draft job>`, the head it was made on, and where to push. No agent runs,
 * so there are no points or rules. The commit's sha comes from the draft job's stored result (`result.draft`).
 */
export async function buildPublishBundle(jobId: string, platform: Pick<PlatformReads, 'gitSpec'>): Promise<PublishBundle> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { chat: { include: { repo: true } } } });
  if (!job.draftOfId) throw new Error(`publish job ${jobId} names no draft`);
  const draftJob = await prisma.job.findUniqueOrThrow({ where: { id: job.draftOfId }, select: { id: true, result: true } });
  // Parsed, so a result stored before drafts existed reads as `draft: null`.
  const draft = JobResult.parse(draftJob.result).draft;
  // Send applies a draft without a commit at once and never queues a publish job for it (engine/drafts.ts), so this is a bug.
  if (!draft) throw new Error(`draft job ${draftJob.id} has no draft commit`);
  const { chat } = job;

  return PublishBundle.parse({
    jobId: job.id,
    attempt: job.attempt,
    type: 'publish',
    pr: { repoFullName: chat.repo.fullName, number: chat.number, headRef: chat.headRef, url: chat.url },
    git: platform.gitSpec({ ref: prRefOf(chat), headRef: chat.headRef, headRepoFullName: chat.headRepoFullName }),
    draft: { jobId: draftJob.id, sha: draft.sha, from: draft.from },
  });
}
