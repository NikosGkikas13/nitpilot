import type { Attention, Permissions, PointOrigin, PointStatus, Role } from '@nitpilot/protocol';

// Who can act in a chat (spec §16): one pure function, table-tested in permissions.test.ts. Every write route
// asks it after the read-access check (http/routes/chat-actions.ts), and the chat view uses it to say which
// buttons to show (chats/views.ts). docs/why/chat-access-rules.md has the table.

/** A change someone asks for in a chat. */
export type ChatAction = { kind: 'note' } | { kind: 'resolve'; point: number } | { kind: 'continue'; point: number } | { kind: 'review' } | { kind: 'retry' };

/** What the rules look at: the chat's people in their roles and its points. */
export type PermissionFacts = {
  closed: boolean;
  /** False for a PR from an outside contributor (spec §6.1). */
  trusted: boolean;
  authorGithubId: string;
  participants: { githubId: string; role: Role; requested: boolean; attention: Attention }[];
  points: { number: number; raisedBy: string; origin: PointOrigin; status: PointStatus }[];
};

/**
 * May this person do this now? Only who they are counts here, not the point's status: a point resolved a moment
 * ago is the engine's to notice, and the route answers 409 for it, not 403. The person is signed in, so they're
 * on Nitpilot. A closed PR allows nothing.
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
      return yours.some((p) => p.attention === 'failed');
  }
}

/** What to offer this person now: Resolve and Continue on escalated points, Review while theirs waits to be started. */
export function permissionsFor(viewer: { githubId: string }, facts: PermissionFacts): Permissions {
  const escalated = facts.points.filter((p) => p.status === 'escalated').map((p) => p.number);
  const waitsForYou = facts.participants.some((p) => p.githubId === viewer.githubId && p.attention === 'manual_review');
  return {
    note: can(viewer, facts, { kind: 'note' }),
    resolve: escalated.filter((point) => can(viewer, facts, { kind: 'resolve', point })),
    continue: escalated.filter((point) => can(viewer, facts, { kind: 'continue', point })),
    review: waitsForYou && can(viewer, facts, { kind: 'review' }),
    retry: can(viewer, facts, { kind: 'retry' }),
  };
}

/** The facts, from a chat row with its participants and points as Prisma reads them. */
export function permissionFacts(chat: {
  closedAt: Date | null;
  trusted: boolean;
  authorGithubId: string;
  participants: { githubId: string; role: string; requested: boolean; attention: string }[];
  points: { number: number; raisedByGithubId: string; origin: string; status: string }[];
}): PermissionFacts {
  return {
    closed: chat.closedAt !== null,
    trusted: chat.trusted,
    authorGithubId: chat.authorGithubId,
    participants: chat.participants.map((p) => ({ githubId: p.githubId, role: p.role as Role, requested: p.requested, attention: p.attention as Attention })),
    points: chat.points.map((p) => ({ number: p.number, raisedBy: p.raisedByGithubId, origin: p.origin as PointOrigin, status: p.status as PointStatus })),
  };
}
