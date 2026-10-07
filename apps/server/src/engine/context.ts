import type { TeamRules } from '@nitpilot/protocol';
import type { ChatState, Command, DomainEvent, NewItem } from './types';

/** The working state of one decide() call. Handlers change `chat` in place and append items and commands. */
export type Ctx = {
  chat: ChatState;
  rules: TeamRules;
  now: Date;
  timeline: NewItem[];
  commands: Command[];
};

/** One event type out of the union: `Ev<'pr_closed'>` is `{ type: 'pr_closed'; merged: boolean }`. */
export type Ev<T extends DomainEvent['type']> = Extract<DomainEvent, { type: T }>;

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
