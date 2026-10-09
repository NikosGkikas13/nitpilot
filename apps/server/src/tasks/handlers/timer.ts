import { z } from 'zod';
import type { Dispatch } from '../../chats/dispatch';
import { PermanentTaskError, type TaskHandler } from '../runner';

const TimerPayload = z.object({ key: z.string() });

/** A debounce or other timer came due: tell the engine (spec §9 DomainEvent `timer`). */
export function timerHandler(dispatch: Dispatch): TaskHandler {
  return async (task) => {
    const { key } = TimerPayload.parse(task.payload);
    if (!task.chatId) throw new PermanentTaskError('timer task without a chat');
    await dispatch(task.chatId, { type: 'timer', key });
  };
}
