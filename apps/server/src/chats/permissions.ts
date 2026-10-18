import type { Attention, Permissions, PointOrigin, PointStatus, Role } from '@nitpilot/protocol';

// Who can act in a chat (spec §16): one pure function, table-tested in permissions.test.ts. Every write route
// asks it after the read-access check (http/routes/chat-actions.ts), and the chat view uses it to say which
// buttons to show (chats/views.ts). docs/why/chat-access-rules.md has the table.

/**
 * A change someone asks for in a chat. `auto` is the switch for one role; `draft` is Send or Discard on a draft whose
 * agent belongs to `owner` (a GitHub id; the route reads it from the draft's job).
 */
export type ChatAction =
  | { kind: 'note' }
  | { kind: 'resolve'; point: number }
  | { kind: 'continue'; point: number }
  | { kind: 'review' }
  | { kind: 'retry' }
  | { kind: 'auto'; role: Role }
  | { kind: 'draft'; owner: string };

const ROLES: readonly Role[] = ['author', 'reviewer'];

/** What the rules look at: the chat's people in their roles and its points. */
export type PermissionFacts = {
  closed: boolean;
  /** False for a PR from an outside contributor (spec §6.1). */
  trusted: boolean;
  authorGithubId: string;
  participants: {
    githubId: string;
    role: Role;
    requested: boolean;
    attention: Attention;
    /** The newest job of this participant (in this role) failed: their agent did, not a post to GitHub (chats/failed-flags.ts). */
    agentFailed: boolean;
  }[];
  points: { number: number; raisedBy: string; origin: PointOrigin; status: PointStatus }[];
  /** The drafts waiting for their owner (a GitHub id), oldest first. */
  drafts: { jobId: string; owner: string }[];
};

/**
 * May this person do this now? Only who they are counts here, not the point's status or whether a draft still waits:
 * a point resolved or a draft sent a moment ago is the engine's to notice, and the route answers 409 for it, not 403.
 * The person is signed in, so they're on Nitpilot. A closed PR allows nothing.
 */
export function can(viewer: { githubId: string }, facts: PermissionFacts, action: ChatAction): boolean {
  if (facts.closed) return false;
  const yours = facts.participants.filter((p) => p.githubId === viewer.githubId);
  switch (action.kind) {
    case 'note':
      return yours.length > 0;
    case 'resolve': {
      // A point from a GitHub comment is resolved on GitHub, by resolving its thread.
      const point = facts.points.find((p) => p.number === action.point);
      return !!point && point.origin === 'agent' && point.raisedBy === viewer.githubId;
    }
    case 'continue': {
      const point = facts.points.find((p) => p.number === action.point);
      return !!point && (viewer.githubId === facts.authorGithubId || point.raisedBy === viewer.githubId);
    }
    case 'review':
      return !facts.trusted && yours.some((p) => p.role === 'reviewer' && p.requested);
    case 'retry':
      // The same checks as the retry route and the engine make, so the button only shows when Retry would work.
      return yours.some((p) => p.attention === 'failed' && p.agentFailed && (p.role === 'author' || p.requested));
    case 'auto':
      // Your own switch, for a role you have here (spec §16 "Auto, drafts and Retry: only your own").
      return yours.some((p) => p.role === action.role);
    case 'draft':
      return yours.length > 0 && action.owner === viewer.githubId;
  }
}

/**
 * What to offer this person now: Resolve and Continue on escalated points, Review while theirs waits to be started,
 * the Auto switch for each of their roles, and Send / Discard on their waiting drafts.
 */
export function permissionsFor(viewer: { githubId: string }, facts: PermissionFacts): Permissions {
  const escalated = facts.points.filter((p) => p.status === 'escalated').map((p) => p.number);
  const waitsForYou = facts.participants.some((p) => p.githubId === viewer.githubId && p.attention === 'manual_review');
  return {
    note: can(viewer, facts, { kind: 'note' }),
    resolve: escalated.filter((point) => can(viewer, facts, { kind: 'resolve', point })),
    continue: escalated.filter((point) => can(viewer, facts, { kind: 'continue', point })),
    review: waitsForYou && can(viewer, facts, { kind: 'review' }),
    retry: can(viewer, facts, { kind: 'retry' }),
    auto: ROLES.filter((role) => can(viewer, facts, { kind: 'auto', role })),
    drafts: facts.drafts.filter((d) => can(viewer, facts, { kind: 'draft', owner: d.owner })).map((d) => d.jobId),
  };
}

/**
 * The facts, from a chat row with its participants (each with its newest job: `jobs: { orderBy: { createdAt: 'desc' },
 * take: 1, select: { status: true } }`) and points as Prisma reads them, and its waiting drafts (jobs that are `done`
 * with `applyState: 'draft'`, each with its participant's GitHub id).
 */
export function permissionFacts(chat: {
  closedAt: Date | null;
  trusted: boolean;
  authorGithubId: string;
  participants: { githubId: string; role: string; requested: boolean; attention: string; jobs: { status: string }[] }[];
  points: { number: number; raisedByGithubId: string; origin: string; status: string }[];
  waitingDrafts: { id: string; participant: { githubId: string } }[];
}): PermissionFacts {
  return {
    closed: chat.closedAt !== null,
    trusted: chat.trusted,
    authorGithubId: chat.authorGithubId,
    participants: chat.participants.map((p) => ({ githubId: p.githubId, role: p.role as Role, requested: p.requested, attention: p.attention as Attention, agentFailed: p.jobs[0]?.status === 'failed' })),
    points: chat.points.map((p) => ({ number: p.number, raisedBy: p.raisedByGithubId, origin: p.origin as PointOrigin, status: p.status as PointStatus })),
    drafts: chat.waitingDrafts.map((j) => ({ jobId: j.id, owner: j.participant.githubId })),
  };
}
