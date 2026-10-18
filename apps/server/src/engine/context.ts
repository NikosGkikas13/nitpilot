import type { TeamRules } from '@nitpilot/protocol';
import type { ChatState, Command, DomainEvent, NewItem } from './types';

/** The working state of one decide() call. Handlers change `chat` in place and append items and commands. */
export type Ctx = {
  chat: ChatState;
  rules: TeamRules;
  now: Date;
  /** The githubId of the person whose own action this event is (see `actorOf`), or null. */
  actor: string | null;
  timeline: NewItem[];
  commands: Command[];
};

/** One event type out of the union: `Ev<'pr_closed'>` is `{ type: 'pr_closed'; merged: boolean }`. */
export type Ev<T extends DomainEvent['type']> = Extract<DomainEvent, { type: T }>;

/**
 * The person who caused this event by their own action in Nitpilot: a click in the web app (Resolve, Continue, the
 * Auto switch, Send, Discard, Review), a note, `nitpilot retry`, or signing in again. Null for everything that comes
 * from GitHub, an agent or a timer. Someone who just acted is looking at the chat, so they aren't notified about
 * what their own action did (advance.ts, "Ready for approval").
 */
export function actorOf(event: DomainEvent): string | null {
  switch (event.type) {
    case 'point_resolve':
    case 'point_continue':
    case 'auto_changed':
    case 'draft_send':
    case 'draft_discard':
    case 'retry_requested':
    case 'signed_in_again':
      return event.who.githubId;
    case 'human_note':
      return event.author.githubId;
    case 'manual_review':
      return event.reviewer.githubId;
    default:
      return null;
  }
}

export function emit(ctx: Ctx, command: Command): void {
  ctx.commands.push(command);
}

export function say(ctx: Ctx, item: Pick<NewItem, 'kind' | 'body'> & Partial<NewItem>): void {
  ctx.timeline.push({ author: null, pointNumber: null, jobId: null, data: null, ...item });
}

export function system(ctx: Ctx, body: string, data: Record<string, unknown> | null = null): void {
  say(ctx, { kind: 'system', body, data });
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}
