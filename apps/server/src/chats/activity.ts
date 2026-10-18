import { FailureReason, type Phase } from '@nitpilot/protocol';
import { prisma } from '../lib/prisma';

/**
 * What a chat is waiting on right now (spec §9.1 "Activity"). Worked out from its jobs and the CLIs
 * that are connected, each time it's shown, and never stored: it changes when a laptop goes to sleep,
 * which no event tells us.
 */
export type Activity =
  | { kind: 'agent_working'; who: string }
  | { kind: 'agent_waiting'; who: string; why: 'offline'; offlineSince: Date | null }
  | { kind: 'agent_waiting'; who: string; why: 'repo_not_linked' | 'cap_reached' }
  | { kind: 'human_turn'; who: string }
  | { kind: 'none' };

/**
 * A token id no CLI has. A publish job whose draft job kept no device (its `cliTokenId` is null) can be taken by no CLI:
 * the assigner leaves it queued for good (jobs/assign.ts). Naming this as its `onlyTokenId` makes its presence read
 * "offline, never seen", the same as the assigner's view, instead of "any of the person's CLIs".
 */
export const NO_DEVICE = 'no-device';

/**
 * A queued or running job, and whose agent it's for. `onlyTokenId` says which CLI can take it: null means any of the
 * person's CLIs; a token id means only that device (a publish job: the laptop that made the draft, spec §9.4);
 * `NO_DEVICE` means none.
 */
export type ActiveJob = { login: string; userId: string; status: 'queued' | 'running'; runAfter: Date; failure: FailureReason | null; onlyTokenId: string | null };

/** A person's CLIs (or one device of theirs): the repos each connected one has linked, and when it was last seen. */
export type Presence = { connected: ReadonlySet<string>[]; lastSeenAt: Date | null };

/**
 * The connected CLIs. The CLI hub is one (ws/cli-hub.ts); tests pass a stand-in. `tokenId` names the device;
 * `usedToday` is how many agent runs that CLI started today (its last ping said so).
 */
export type LiveClis = { connectionsFor(userId: string): readonly { tokenId: string; repos: ReadonlySet<string>; usedToday: number }[] };

export type ActivityFacts = {
  phase: Phase;
  repoFullName: string;
  /** The PR author's login. */
  author: string | null;
  /** A human reviewer whose answered GitHub point waits for them, if one does. */
  reviewerToAnswer: string | null;
  /** Queued and running jobs, oldest first. */
  jobs: ActiveJob[];
  /** The person's CLIs when `onlyTokenId` is null, otherwise only the device it names (`NO_DEVICE` names none: always offline). */
  presence: (userId: string, onlyTokenId: string | null) => Presence;
  now: Date;
};

/** Jobs a CLI turned down because its owner's limits were reached: they wait (spec §9.4). */
const LIMITS: ReadonlySet<FailureReason> = new Set(['daily_cap', 'quota']);

export function deriveActivity(f: ActivityFacts): Activity {
  // An agent that can't start is what a person needs to hear about, so it comes first.
  for (const job of f.jobs) {
    const waiting = waitingFor(job, f);
    if (waiting) return waiting;
  }
  const job = f.jobs.find((j) => j.status === 'running') ?? f.jobs[0];
  if (job) return { kind: 'agent_working', who: job.login };
  if (f.phase === 'addressing' && f.author) return { kind: 'human_turn', who: f.author };
  if (f.phase === 'reviewing' && f.reviewerToAnswer) return { kind: 'human_turn', who: f.reviewerToAnswer };
  return { kind: 'none' };
}

/**
 * Why a queued job can't go to a CLI now, or null when one can take it. A job only one device can take waits for
 * that device: another of the person's CLIs being online doesn't help it.
 */
function waitingFor(job: ActiveJob, f: ActivityFacts): Activity | null {
  if (job.status !== 'queued') return null;
  const presence = f.presence(job.userId, job.onlyTokenId);
  if (presence.connected.length === 0) return { kind: 'agent_waiting', who: job.login, why: 'offline', offlineSince: presence.lastSeenAt };
  if (!presence.connected.some((repos) => repos.has(f.repoFullName))) return { kind: 'agent_waiting', who: job.login, why: 'repo_not_linked' };
  if (job.failure !== null && LIMITS.has(job.failure) && job.runAfter > f.now) return { kind: 'agent_waiting', who: job.login, why: 'cap_reached' };
  return null;
}

/** The activity of one chat, read from the database and the connected CLIs. A chat that is gone has none. */
export async function loadActivity(chatId: string, clis: LiveClis, now = new Date()): Promise<Activity> {
  const activities = await loadActivities([chatId], clis, now);
  return activities.get(chatId) ?? { kind: 'none' };
}

/**
 * The activity of many chats, by chat id, for the inbox. The number of queries doesn't grow with the number
 * of chats: one read of the chats with their people, points and jobs, one of when each person's CLIs were
 * last seen, and, when publish jobs are waiting, one of the devices that made their drafts
 * (docs/why/n-plus-one-queries.md). A chat id that doesn't exist is left out.
 */
export async function loadActivities(chatIds: string[], clis: LiveClis, now = new Date()): Promise<Map<string, Activity>> {
  if (chatIds.length === 0) return new Map();
  const chats = await prisma.prChat.findMany({
    where: { id: { in: chatIds } },
    include: {
      repo: true,
      participants: true,
      // Only a point a person raised on GitHub waits for them to answer; an agent's point doesn't.
      points: { where: { status: 'addressed', origin: 'github' }, orderBy: { number: 'asc' } },
      jobs: { where: { status: { in: ['queued', 'running'] } }, include: { participant: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  const userIds = [...new Set(chats.flatMap((chat) => chat.jobs.map((j) => j.userId)))];
  // When each of them was last seen: the newest lastSeenAt of their CLI tokens (spec §8).
  const seen = userIds.length > 0 ? await prisma.cliToken.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _max: { lastSeenAt: true } }) : [];
  const lastSeen = (userId: string) => seen.find((s) => s.userId === userId)?._max.lastSeenAt ?? null;
  const devices = await draftDevices(chats.flatMap((chat) => chat.jobs.map((j) => j.draftOfId)));
  const presence = (userId: string, onlyTokenId: string | null): Presence => {
    const connected = clis.connectionsFor(userId).filter((c) => onlyTokenId === null || c.tokenId === onlyTokenId);
    const lastSeenAt = onlyTokenId === null ? lastSeen(userId) : (devices.lastSeen.get(onlyTokenId) ?? null);
    return { connected: connected.map((c) => c.repos), lastSeenAt };
  };

  const activities = new Map<string, Activity>();
  for (const chat of chats) {
    const loginOf = (githubId: string) => chat.participants.find((p) => p.githubId === githubId)?.login ?? null;
    activities.set(
      chat.id,
      deriveActivity({
        phase: chat.phase as Phase,
        repoFullName: chat.repo.fullName,
        author: loginOf(chat.authorGithubId),
        reviewerToAnswer: chat.points[0] ? loginOf(chat.points[0].raisedByGithubId) : null,
        jobs: chat.jobs.map((j) => ({
          login: j.participant.login,
          userId: j.userId,
          status: j.status as ActiveJob['status'],
          runAfter: j.runAfter,
          failure: failureOf(j.failure),
          onlyTokenId: j.draftOfId ? (devices.ofDraft.get(j.draftOfId) ?? NO_DEVICE) : null,
        })),
        presence,
        now,
      }),
    );
  }
  return activities;
}

/**
 * For publish jobs (`draftOfId` set): the device that made each draft (`ofDraft`, draft job id → CLI token id), and
 * when that device was last seen (`lastSeen`, token id → time). One query, and none without publish jobs.
 */
async function draftDevices(draftOfIds: (string | null)[]): Promise<{ ofDraft: Map<string, string>; lastSeen: Map<string, Date | null> }> {
  const ids = draftOfIds.filter((id): id is string => id !== null);
  const ofDraft = new Map<string, string>();
  const lastSeen = new Map<string, Date | null>();
  if (ids.length === 0) return { ofDraft, lastSeen };
  const drafts = await prisma.job.findMany({ where: { id: { in: ids } }, select: { id: true, cliTokenId: true, cliToken: { select: { lastSeenAt: true } } } });
  for (const d of drafts) {
    if (!d.cliTokenId) continue;
    ofDraft.set(d.id, d.cliTokenId);
    lastSeen.set(d.cliTokenId, d.cliToken?.lastSeenAt ?? null);
  }
  return { ofDraft, lastSeen };
}

/** The stored failure as a FailureReason, or null for one this version doesn't know. */
function failureOf(stored: string | null): FailureReason | null {
  const parsed = FailureReason.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
