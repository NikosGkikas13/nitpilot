import { z } from 'zod';

/** Bumped only for breaking changes; the server closes old CLIs with CLOSE_CODES.upgradeCli. */
export const PROTOCOL_VERSION = 1;
/** The CLI pings every 25 s; a running job's lease lasts 90 s (spec §9.4). */
export const PING_SEC = 25;
export const LEASE_SEC = 90;
/** Where CLIs open their WebSocket (spec §10). */
export const CLI_WS_PATH = '/ws/cli';

/**
 * Every WebSocket message has the same envelope: `{ v: 1, t: "<type>", id?, re?, d: {…} }`.
 * `id` names a message that expects an answer; `re` is the id being answered.
 */
export function message<T extends string, D extends z.ZodType>(t: T, d: D) {
  return z.object({
    v: z.literal(1),
    t: z.literal(t),
    id: z.string().optional(),
    re: z.string().optional(),
    d,
  });
}

export function encode(msg: { t: string; d: unknown; id?: string; re?: string }): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}
