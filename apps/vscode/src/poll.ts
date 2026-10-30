import type { MyChat } from '@nitpilot/protocol';
import { loadConfig } from 'nitpilot/src/config/config';
import { ServerClient, ServerError } from 'nitpilot/src/http';

// shortcut: polling (30 s, focused windows only); a live "my chats changed" stream on a token-authed socket if users ask for instant updates.
export const POLL_INTERVAL_MS = 30_000;
/** Each request gives up after this long, so a hung server shows as unreachable instead of a frozen sidebar. */
export const POLL_TIMEOUT_MS = 10_000;

/** What one poll found. The status bar and the sidebar are drawn from this (view-model.ts). */
export type Poll =
  | { state: 'ok'; server: string; chats: MyChat[] }
  | { state: 'needs_reauth'; server: string; chats: MyChat[] | null }
  | { state: 'logged_out'; server: string | null }
  | { state: 'unreachable'; server: string; message: string }
  | { state: 'error'; server: string | null; message: string };

/** `timeoutMs` is for tests: fake timers don't drive AbortSignal.timeout. */
export type PollDeps = { env?: Record<string, string | undefined>; fetch?: typeof fetch; timeoutMs?: number };

const UPDATE_HINT = "Update the Nitpilot extension, or check the server's version.";

/**
 * Ask the server who you are and which PRs you have open, with the CLI's own login (spec: "Talking to the server").
 * Never throws: every failure becomes a state. The config is read again each time, so `nitpilot login` shows up on
 * the next poll.
 */
export async function poll(deps: PollDeps = {}): Promise<Poll> {
  let cfg: ReturnType<typeof loadConfig>;
  try {
    cfg = loadConfig({ env: deps.env ?? process.env });
  } catch (err) {
    return { state: 'error', server: null, message: (err as Error).message };
  }
  const server = cfg.server;
  if (!cfg.token) return { state: 'logged_out', server };

  const client = new ServerClient(server, cfg.token, deps.fetch);
  const timeoutMs = deps.timeoutMs ?? POLL_TIMEOUT_MS;
  const [me, chats] = await Promise.allSettled([
    client.me({ signal: AbortSignal.timeout(timeoutMs) }),
    client.myChats({ signal: AbortSignal.timeout(timeoutMs) }),
  ]);

  // /api/me never needs GitHub, so it decides who you are. /api/me/chats fails with 401 when your GitHub sign-in
  // expired, at the same moment /api/me says so: read the flag from /api/me, never the error text.
  if (me.status === 'rejected' && isStatus(me.reason, (s) => s === 401)) return { state: 'logged_out', server };
  if (me.status === 'fulfilled' && me.value.githubAuth === 'needs_reauth') {
    return { state: 'needs_reauth', server, chats: chats.status === 'fulfilled' ? chats.value.chats : null };
  }

  const failure = [me, chats].find((r) => r.status === 'rejected')?.reason;
  if (failure === undefined && chats.status === 'fulfilled') return { state: 'ok', server, chats: chats.value.chats };

  const message = (failure as Error).message;
  if (isStatus(failure, (s) => s === 0 || s >= 500)) return { state: 'unreachable', server, message };
  // A 2xx that failed the schema check: the server and the protocol bundled in here have drifted apart.
  if (isStatus(failure, (s) => s >= 200 && s < 300)) return { state: 'error', server, message: `${message} ${UPDATE_HINT}` };
  return { state: 'error', server, message };
}

function isStatus(err: unknown, test: (status: number) => boolean): boolean {
  return err instanceof ServerError && test(err.status);
}

/** Calls made while a run is still going get that same run, so a burst of triggers is one request. */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    running ??= fn().finally(() => {
      running = null;
    });
    return running;
  };
}
