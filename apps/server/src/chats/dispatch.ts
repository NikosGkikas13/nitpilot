import { decide } from '../engine/decide';
import type { DecideOutput, DomainEvent } from '../engine/types';
import { KeyedLock } from '../lib/key-lock';
import { prisma } from '../lib/prisma';
import { applyCommands, type DispatchEffects } from './apply-commands';
import { loadChat } from './load';
import { appendTimeline, saveChatState } from './save';

export type { DispatchEffects };
export type DispatchOptions = {
  /** GitHub comment ids this event carries. They're marked as seen in the same transaction (route-event.ts). */
  seenCommentIds?: string[];
};
export type Dispatch = (chatId: string, event: DomainEvent, opts?: DispatchOptions) => Promise<DecideOutput>;
type Listener = (chatId: string, effects: DispatchEffects) => void;

/**
 * Runs one event through the engine and saves the result (spec §9 "The dispatcher").
 * Events for the same chat run one at a time; GitHub is never called while the lock is held.
 */
export class Dispatcher {
  private readonly locks = new KeyedLock();
  private readonly listeners: Listener[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Called after each commit, e.g. to wake the task runner. */
  onCommit(listener: Listener): void {
    this.listeners.push(listener);
  }

  dispatch: Dispatch = (chatId, event, opts = {}) =>
    this.locks.run(chatId, async () => {
      const loaded = await loadChat(chatId);
      const now = this.now();
      const out = decide({ chat: loaded.state, rules: loaded.rules, event, now });
      const effects = await prisma.$transaction(async (tx) => {
        await saveChatState(tx, chatId, loaded.state, out.chat, now);
        const timeline = await appendTimeline(tx, chatId, out.timeline);
        // All or nothing: a comment counts as seen only if what it caused was saved too.
        const seen = opts.seenCommentIds ?? [];
        if (seen.length > 0) await tx.seenComment.createMany({ data: seen.map((commentId) => ({ commentId })), skipDuplicates: true });
        return { ...(await applyCommands(tx, chatId, out.commands, now)), timeline };
      });
      for (const listener of this.listeners) {
        try {
          listener(chatId, effects);
        } catch (err) {
          console.error('[dispatch] listener failed:', err);
        }
      }
      return out;
    });
}
