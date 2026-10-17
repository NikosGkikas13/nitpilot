import { z } from 'zod';

/**
 * The CLI protocol a CLI speaks, sent in `hello` (spec §10): 1 in Plan 1, 2 from Plan 2 on (publish jobs, draft
 * results, settings from the server). Bumped only for breaking changes; the server closes a CLI that speaks another
 * one with CLOSE_CODES.upgradeCli.
 */
export const PROTOCOL_VERSION = 2;

/** The envelope's own version, `v` in every message. Protocol 2 changed what travels inside, not the envelope. */
export const ENVELOPE_VERSION = 1;

/** The biggest WebSocket message the server accepts (spec §10). The CLI checks a result against it before sending. */
export const MAX_MESSAGE_BYTES = 1_000_000;
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
    v: z.literal(ENVELOPE_VERSION),
    t: z.literal(t),
    id: z.string().optional(),
    re: z.string().optional(),
    d,
  });
}

export function encode(msg: { t: string; d: unknown; id?: string; re?: string }): string {
  return JSON.stringify({ v: ENVELOPE_VERSION, ...msg });
}
