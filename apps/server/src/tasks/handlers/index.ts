import type { Dispatch } from '../../chats/dispatch';
import type { PlatformWrites } from '../../platform/types';
import type { Notifier } from '../notifier';
import type { TaskHandlers } from '../runner';
import { notifyHandler } from './notify';
import { repliesHandler } from './replies';
import { reviewHandler } from './review';
import { summaryHandler } from './summary';
import { timerHandler } from './timer';

export type TaskHandlerDeps = { platform: PlatformWrites; notifier: Notifier; dispatch: Dispatch };

/** Every task kind the dispatcher creates (chats/apply-commands.ts), and who runs it. */
export function createTaskHandlers(deps: TaskHandlerDeps): TaskHandlers {
  return {
    timer: timerHandler(deps.dispatch),
    summary: summaryHandler(deps),
    post_review: reviewHandler(deps),
    thread_replies: repliesHandler(deps),
    notify: notifyHandler(deps),
  };
}
