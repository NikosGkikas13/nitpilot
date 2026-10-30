import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, type Attention, type MyChat } from '@nitpilot/protocol';
import { configDir, loadConfig } from '../config/config';
import { CliError } from '../errors';
import { joinServerUrl, ServerClient } from '../http';
import { terminal, type Out } from '../out';

/** `table` for people, `json` for scripts and the Claude Code plugin, `line` for a status line. */
export type StatusFormat = 'table' | 'json' | 'line';
export type StatusDeps = { env?: Record<string, string | undefined>; out?: Out; fetch?: typeof fetch; format?: StatusFormat; now?: () => number };

/** A status line runs on every redraw, so `--line` reuses its last answer for this long instead of asking the server again. */
export const LINE_CACHE_MS = 30_000;
/** A status line must never hang its editor. */
const LINE_TIMEOUT_MS = 3_000;

export function statusOptions(args: string[]): { format: StatusFormat } {
  if (args.length === 0) return { format: 'table' };
  if (args.length === 1 && args[0] === '--json') return { format: 'json' };
  if (args.length === 1 && args[0] === '--line') return { format: 'line' };
  throw new CliError(`Usage: ${BRAND.cli} status [--json|--line]`);
}

/** What the NEEDS YOU column says for each attention flag. */
export const NEEDS: Record<Attention, string> = {
  none: '',
  decision: 'a decision',
  manual_review: 'start review',
  failed: 'agent failed',
  drafts: 'drafts',
};

/** `nitpilot status` (spec §11): who you are on the server, and your open PRs with Nitpilot. */
export async function status(deps: StatusDeps = {}): Promise<void> {
  const out = deps.out ?? terminal;
  if (deps.format === 'line') return out.log(await cachedLine(deps));
  const cfg = loadConfig({ env: deps.env });
  const client = new ServerClient(cfg.server, cfg.token, deps.fetch);
  const [me, { chats }] = await Promise.all([client.me(), client.myChats()]);

  if (deps.format === 'json') {
    return out.log(JSON.stringify({ login: me.login, server: cfg.server, githubAuth: me.githubAuth, chats }, null, 2));
  }

  out.log(`Logged in as ${me.login} on ${cfg.server}`);
  if (me.githubAuth === 'needs_reauth') {
    out.log(`! GitHub access expired. Sign in again at ${joinServerUrl(cfg.server, '/').href} so ${BRAND.name} can post in your name.`);
  }
  if (chats.length === 0) {
    out.log(`No open PRs with ${BRAND.name} yet.`);
    return;
  }
  out.log('');
  out.log(table([['PR', 'ROLE', 'PHASE', 'ROUND', 'NEEDS YOU', 'TITLE'], ...chats.map(row)]));
  for (const chat of chats.filter((c) => c.attention === 'failed')) {
    out.log('');
    out.log(`Your agent couldn't finish on ${chat.repo}#${chat.number}. To run it again: ${BRAND.cli} retry ${prUrl(chat)}`);
  }
}

/** The `--line` text, from a cache file next to config.json while it is fresh. */
async function cachedLine(deps: StatusDeps): Promise<string> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? Date.now)();
  const dir = configDir(env);
  const path = join(dir, 'status-line.json');
  if (!hasToken(env)) return `${BRAND.name}: not logged in`; // checked before the cache, so it changes the moment you log in
  try {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { at: number; text: string };
    if (now - cached.at < LINE_CACHE_MS) return cached.text;
  } catch {
    // No cache yet, or a broken one: ask the server.
  }
  const text = await line(env, deps.fetch);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ at: now, text }));
  } catch {
    // Not being able to cache only means asking the server again next time.
  }
  return text;
}

function hasToken(env: Record<string, string | undefined>): boolean {
  try {
    return Boolean(loadConfig({ env }).token);
  } catch {
    return true; // a broken config.json: let the server call below report it as a line
  }
}

/** One short line, never an error: a status line shows whatever it prints. */
async function line(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<string> {
  try {
    const cfg = loadConfig({ env });
    const { chats } = await new ServerClient(cfg.server, cfg.token, fetchImpl).myChats({ signal: AbortSignal.timeout(LINE_TIMEOUT_MS) });
    if (chats.length === 0) return `${BRAND.name}: no open PRs`;
    const needYou = chats.filter((c) => c.attention !== 'none').length;
    const open = `${chats.length} open`;
    return needYou === 0 ? `${BRAND.name}: ${open}, nothing needs you` : `${BRAND.name}: ${needYou} need${needYou === 1 ? 's' : ''} you · ${open}`;
  } catch {
    return `${BRAND.name}: can't reach the server`;
  }
}

function row(c: MyChat): string[] {
  const title = c.title.length > 50 ? `${c.title.slice(0, 49)}…` : c.title;
  return [`${c.repo}#${c.number}`, c.role, c.phase, String(c.round), NEEDS[c.attention], title];
}

/** Columns padded to their widest cell. */
function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)));
  return rows.map((r) => r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd()).join('\n');
}

/** The PR on GitHub: the link `nitpilot retry` takes. */
export function prUrl(chat: Pick<MyChat, 'repo' | 'number'>): string {
  return `https://github.com/${chat.repo}/pull/${chat.number}`;
}
