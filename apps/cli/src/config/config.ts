import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AgentId, BRAND } from '@nitpilot/protocol';
import { z } from 'zod';
import { CliError } from '../errors';

/** The hosted instance (Plan 3). For another server, set NITPILOT_SERVER or "server" in the file. */
export const DEFAULT_SERVER = 'https://nitpilot.dev';

const ENV = {
  configDir: `${BRAND.envPrefix}CONFIG_DIR`,
  server: `${BRAND.envPrefix}SERVER`,
  token: `${BRAND.envPrefix}TOKEN`,
} as const;

type Env = Record<string, string | undefined>;

/** One linked clone (spec §13): where it is, how to prepare a fresh checkout, and which checks the agent may run. */
const RepoConfig = z.strictObject({
  path: z.string().min(1),
  setup: z.array(z.string()).min(1).optional(),
  checks: z.record(z.string(), z.array(z.string()).min(1)).optional(),
});

/**
 * Settings Plan 1 kept in config.json that live on the server from Plan 2 on (spec §13): the Auto defaults and the daily
 * job cap, edited on the web app's Settings page. A file that still has them is accepted; they are ignored, and dropped
 * the next time the file is saved. `nitpilot doctor` says where they went.
 */
export const IGNORED_SETTINGS = ['auto', 'dailyJobCap'] as const;

const SERVER_ADDRESS_MESSAGE = 'The server address must start with https:// (http is only for a server on this computer).';

const SERVER_QUERY_MESSAGE = "The server address can't have a ?query or #fragment.";

/** A path is added after the address (joinServerUrl), so a query or fragment would end up in the middle. Checked on the raw text: `new URL` drops an empty `?` or `#`. */
function hasNoQueryOrFragment(address: string): boolean {
  if (!URL.canParse(address)) return true; // z.url() has already said so
  return !address.includes('?') && !address.includes('#');
}

/** https anywhere; http only for a server on this computer, because http sends the device token in the clear. */
function isHttpsOrThisComputer(address: string): boolean {
  // Not a URL at all: z.url() has already said so, and a second message would only repeat it (new URL would also throw).
  if (!URL.canParse(address)) return true;
  const { protocol, hostname } = new URL(address);
  if (protocol === 'https:') return true;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}

/**
 * config.json (spec §13). Every field has a default, so a missing or empty file is valid.
 * Names it doesn't know are rejected, so a typo is an error instead of a setting silently ignored (and dropped on the next save).
 * IGNORED_SETTINGS are taken out first, so an old file isn't an error.
 */
export const PersonalConfigSchema = z.preprocess(
  withoutIgnoredSettings,
  z.strictObject({
    server: z
      .url({ protocol: /^https?$/ })
      .refine(isHttpsOrThisComputer, { error: SERVER_ADDRESS_MESSAGE })
      .refine(hasNoQueryOrFragment, { error: SERVER_QUERY_MESSAGE })
      .default(DEFAULT_SERVER),
    token: z.string().startsWith(BRAND.tokenPrefix).nullable().default(null),
    agent: AgentId.default('claude-code'),
    concurrency: z.number().int().min(1).max(4).default(1),
    jobTimeoutMinutes: z.number().int().min(1).max(120).default(15),
    /** The model your agent uses, in its own naming (e.g. `claude-sonnet-5.5`). Unset: the agent's default. */
    model: z.string().min(1).optional(),
    /** Claude Code only: let it bill your API key. Off: ANTHROPIC_API_KEY never reaches the agent (spec §12.2). */
    apiBilling: z.boolean().default(false),
    /** Linked clones, keyed `owner/name`. */
    repos: z.record(z.string(), RepoConfig).default({}),
  }),
);
export type PersonalConfig = z.infer<typeof PersonalConfigSchema>;

/** Where the config lives: $NITPILOT_CONFIG_DIR, else $XDG_CONFIG_HOME/nitpilot, else ~/.config/nitpilot. */
export function configDir(env: Env = process.env): string {
  const own = env[ENV.configDir];
  if (own) return own;
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), BRAND.configDirName);
}

export function configPath(dir: string): string {
  return join(dir, 'config.json');
}

/** The settings in effect: the file, with NITPILOT_SERVER and NITPILOT_TOKEN winning one field at a time. */
export function loadConfig(opts: { env?: Env; dir?: string } = {}): PersonalConfig {
  const env = opts.env ?? process.env;
  const dir = opts.dir ?? configDir(env);
  const raw = readRaw(configPath(dir));
  const server = env[ENV.server];
  const token = env[ENV.token];
  if (server) raw.server = server;
  if (token) raw.token = token;
  return parse(raw, `${configPath(dir)} (or ${ENV.server} / ${ENV.token})`);
}

/** The file alone, without the environment. Change what this returns and save it: no override ends up in the file. */
export function loadConfigFile(dir: string): PersonalConfig {
  return parse(readRaw(configPath(dir)), configPath(dir));
}

/** Save the config readable by you only (0600), even when the old file had looser permissions. */
export function saveConfig(cfg: PersonalConfig, dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = configPath(dir);
  const tmp = `${path}.tmp`;
  // Write a new file, then swap it in: a crash halfway never leaves a half-written config behind.
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600); // mode only applies to new files; a leftover .tmp could have another one
  renameSync(tmp, path);
}

/** The file's settings without IGNORED_SETTINGS. Anything that isn't an object is left for the schema to refuse. */
function withoutIgnoredSettings(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const ignored: readonly string[] = IGNORED_SETTINGS;
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !ignored.includes(key)));
}

/** Which of IGNORED_SETTINGS the config file in `dir` still has. None when there's no file or it can't be read. */
export function ignoredSettingsIn(dir: string): string[] {
  let raw: Record<string, unknown>;
  try {
    raw = readRaw(configPath(dir));
  } catch {
    return []; // loading the config reports that problem
  }
  return IGNORED_SETTINGS.filter((key) => Object.hasOwn(raw, key));
}

function readRaw(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new CliError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new CliError(`${path} must hold a JSON object.`);
  return json as Record<string, unknown>;
}

function parse(raw: Record<string, unknown>, where: string): PersonalConfig {
  const parsed = PersonalConfigSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  // A misspelled name: point at the name itself, not at the object it sits in.
  if (issue.code === 'unrecognized_keys') throw new CliError(`Unknown setting "${[...issue.path, issue.keys[0]].join('.')}" in ${where}. Check the spelling.`);
  throw new CliError(`Invalid setting "${issue.path.join('.') || '(the whole file)'}" in ${where}: ${issue.message}`);
}
