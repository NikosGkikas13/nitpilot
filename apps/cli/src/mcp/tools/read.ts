import picomatch from 'picomatch';
import { safeGit, SafeGitError, type GitPlace } from '../../runner/safe-git';
import type { McpJobContext } from '../context';
import { ToolError } from '../tool';
import { wrapUntrusted } from '../untrusted';

/** The most a diff or a file can send back at once: 100 KB is about 25,000 tokens. */
export const MAX_TOOL_OUTPUT_BYTES = 100 * 1024;

/** A file bigger than this isn't read at all: it wouldn't fit in a reply, and git's output buffer has a limit too. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Never run a program the repo or your git config picks: `--no-ext-diff` ignores `diff.external` and
 * `--no-textconv` ignores the converters a PR's `.gitattributes` can name. `--no-color`: plain text for the agent.
 */
const PLAIN_DIFF = ['--no-ext-diff', '--no-textconv', '--no-color'];

export type ChangedFile = {
  path: string;
  /** For a renamed file, where it was. */
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  adds: number;
  dels: number;
  binary: boolean;
  /** Matched by the team's `ignore_paths`: no points on it. */
  ignored: boolean;
};

export type ChangedFiles = { files: ChangedFile[]; note?: string };

/**
 * Where the read tools run git: on the job's git objects only (`--bare`), never on the worktree's
 * files, so whatever the agent edits there can't change what it reads.
 */
function objects(ctx: McpJobContext): GitPlace {
  const { gitDir, hooksDir, signal, env } = ctx.worktree.git;
  return { gitDir, hooksDir, signal, env };
}

const git = (ctx: McpJobContext, args: string[]) => safeGit(objects(ctx), args);

/** The commit the PR branched from: what the diff compares against, and what `ref: "base"` reads. */
export async function diffBaseSha(ctx: McpJobContext): Promise<string> {
  return (await git(ctx, ['merge-base', ctx.worktree.baseSha, ctx.worktree.headSha])).stdout.trim();
}

/**
 * The commits to compare: `since..head` for a re-review, or everything the PR changes. When `since`
 * isn't in head's history any more (a force-push rewrote it), the whole PR is compared and a note
 * says so (Review Focus #3).
 */
async function diffRange(ctx: McpJobContext, since: string | undefined): Promise<{ from: string; note?: string }> {
  const { headSha } = ctx.worktree;
  if (since === undefined) return { from: await diffBaseSha(ctx) };
  if (await isAncestor(ctx, since, headSha)) return { from: since };
  return {
    from: await diffBaseSha(ctx),
    note: `Full re-review: history was rewritten since ${since.slice(0, 7)} (a force-push?), so this covers every change in the PR.`,
  };
}

async function isAncestor(ctx: McpJobContext, commit: string, of: string): Promise<boolean> {
  try {
    await git(ctx, ['merge-base', '--is-ancestor', commit, of]);
    return true;
  } catch (err) {
    // 1: not an ancestor. 128: git doesn't have that commit at all (it was force-pushed away).
    if (err instanceof SafeGitError && (err.code === 1 || err.code === 128)) return false;
    throw err;
  }
}

/** `list_changed_files`: what the PR changed (or, with `since`, what changed after that commit). */
export async function listChangedFiles(ctx: McpJobContext, args: { since?: string } = {}): Promise<ChangedFiles> {
  const { from, note } = await diffRange(ctx, args.since);
  const range = [from, ctx.worktree.headSha];
  // -z: file names exactly as they are (spaces, unicode), never quoted. -M: a moved file is one rename, not a delete and an add.
  const statuses = (await git(ctx, ['diff', ...PLAIN_DIFF, '-z', '-M', '--name-status', ...range])).stdout;
  const counts = (await git(ctx, ['diff', ...PLAIN_DIFF, '-z', '-M', '--numstat', ...range])).stdout;
  const isIgnored = picomatch(ctx.bundle.rules.ignorePaths, { dot: true });
  const lineCounts = parseNumstat(counts);
  const files = parseNameStatus(statuses).map((file) => {
    const count = lineCounts.get(file.path);
    const binary = count === undefined || count.adds === null;
    return { ...file, adds: count?.adds ?? 0, dels: count?.dels ?? 0, binary, ignored: isIgnored(file.path) };
  });
  return note ? { files, note } : { files };
}

const STATUS = { A: 'added', M: 'modified', T: 'modified', D: 'deleted', R: 'renamed' } as const;

/** `git diff --name-status -z`: `M\0path\0`, or `R100\0old\0new\0` for a rename. */
function parseNameStatus(out: string): Pick<ChangedFile, 'path' | 'oldPath' | 'status'>[] {
  const parts = out.split('\0');
  const files: Pick<ChangedFile, 'path' | 'oldPath' | 'status'>[] = [];
  for (let i = 0; i + 1 < parts.length; ) {
    const letter = parts[i]!.charAt(0) as keyof typeof STATUS;
    if (letter === 'R') {
      files.push({ path: parts[i + 2]!, oldPath: parts[i + 1]!, status: 'renamed' });
      i += 3;
    } else {
      files.push({ path: parts[i + 1]!, status: STATUS[letter] ?? 'modified' });
      i += 2;
    }
  }
  return files;
}

/** `git diff --numstat -z`: `adds\tdels\tpath\0`, or `adds\tdels\t\0old\0new\0` for a rename. Binary files count `-`. */
function parseNumstat(out: string): Map<string, { adds: number | null; dels: number | null }> {
  const parts = out.split('\0');
  const counts = new Map<string, { adds: number | null; dels: number | null }>();
  for (let i = 0; i < parts.length && parts[i] !== ''; i++) {
    const [adds, dels, path] = parts[i]!.split('\t');
    const number = (n: string | undefined) => (n === undefined || n === '-' ? null : Number(n));
    if (path === '') {
      counts.set(parts[i + 2]!, { adds: number(adds), dels: number(dels) }); // a rename: the new path is two parts on
      i += 2;
    } else {
      counts.set(path!, { adds: number(adds), dels: number(dels) });
    }
  }
  return counts;
}

/** `get_diff`: one file's changes, as a unified diff. Only files the PR (or `since`) changed. */
export async function getDiff(ctx: McpJobContext, args: { path: string; since?: string }): Promise<string> {
  const { files, note } = await listChangedFiles(ctx, args);
  const file = files.find((f) => f.path === args.path);
  if (!file) throw new ToolError(`${args.path} isn't among the changed files${args.since ? ` since ${args.since.slice(0, 7)}` : ''}. list_changed_files shows them.`);
  const { from } = await diffRange(ctx, args.since);
  // `:(literal)`: the path is a file name, never a pattern. A rename names both sides, so git shows it as one.
  const paths = [file.oldPath, file.path].filter((p): p is string => p !== undefined).map((p) => `:(literal)${p}`);
  const diff = (await git(ctx, ['diff', ...PLAIN_DIFF, '-M', from, ctx.worktree.headSha, '--', ...paths])).stdout;
  const text = capped(diff, 'Ask get_file for a part of the file instead.');
  return note ? `${note}\n\n${text}` : text;
}

/** `get_file`: a file as it is on the PR's head or its base, read from git (never from the folder), with line numbers. */
export async function getFile(ctx: McpJobContext, args: { path: string; ref: 'base' | 'head'; from?: number; to?: number }): Promise<string> {
  const sha = args.ref === 'head' ? ctx.worktree.headSha : await diffBaseSha(ctx);
  let size: number;
  let content: string;
  try {
    // `cat-file -s`: the size in bytes, before reading anything. (A folder passes this and fails at `blob` below.)
    size = Number((await git(ctx, ['cat-file', '-s', `${sha}:${args.path}`])).stdout);
    if (size > MAX_FILE_BYTES) return `${args.path} is ${size} bytes, too large to read.`;
    // `cat-file blob`: the file's bytes exactly as committed. It refuses a folder, and never runs a converter (textconv).
    content = (await git(ctx, ['cat-file', 'blob', `${sha}:${args.path}`])).stdout;
  } catch (err) {
    if (err instanceof SafeGitError && err.code === 128) throw new ToolError(`${args.path} isn't a file on the PR's ${args.ref}.`);
    throw err;
  }
  if (content.includes('\0')) return `${args.path} is a binary file (${size} bytes).`;
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop(); // the newline at the end of the file isn't a line of its own
  const first = Math.max(1, args.from ?? 1);
  const last = Math.min(lines.length, args.to ?? lines.length);
  const numbered = lines.slice(first - 1, last).map((line, i) => `${String(first + i).padStart(5)}  ${line}`);
  return capped(`${args.path} (${args.ref}), lines ${first}-${last} of ${lines.length}:\n${numbered.join('\n')}`, 'Ask for fewer lines with from and to.');
}

/**
 * Text cut at MAX_TOOL_OUTPUT_BYTES, with a note saying so. It cuts on a line break when that keeps at
 * least half of the allowance; a minified bundle or one-line JSON has none, so then it cuts at the byte
 * limit (dropping a character the cut split in two) and ends that line itself.
 */
function capped(text: string, hint: string): string {
  if (Buffer.byteLength(text) <= MAX_TOOL_OUTPUT_BYTES) return text;
  const cut = Buffer.from(text).subarray(0, MAX_TOOL_OUTPUT_BYTES).toString();
  const lineEnd = cut.lastIndexOf('\n') + 1;
  const kept = Buffer.byteLength(cut.slice(0, lineEnd)) >= MAX_TOOL_OUTPUT_BYTES / 2 ? cut.slice(0, lineEnd) : `${cut.replace(/\uFFFD$/, '')}\n`;
  return `${kept}[cut at ${MAX_TOOL_OUTPUT_BYTES / 1024} KB. ${hint}]`;
}

/** `get_job`: the job, the PR and its conversation. Text anyone could have written is wrapped as untrusted. */
export function getJob(ctx: McpJobContext) {
  const { bundle, worktree } = ctx;
  return {
    type: bundle.type,
    round: bundle.round,
    maxRounds: bundle.maxRounds,
    you: bundle.you,
    pr: {
      repo: bundle.pr.repoFullName,
      number: bundle.pr.number,
      url: bundle.pr.url,
      author: bundle.pr.authorLogin,
      baseRef: bundle.pr.baseRef,
      headRef: bundle.pr.headRef,
      headSha: worktree.headSha,
      title: wrapUntrusted('pr_title', bundle.pr.title),
      body: wrapUntrusted('pr_body', bundle.pr.body),
    },
    sinceSha: bundle.sinceSha,
    // From the base branch, never the PR's own copy: a PR can't rewrite its rules (spec §11 step 3).
    conventions: worktree.conventions,
    notes: bundle.notes.map((note) => ({ author: note.author, at: note.at, body: wrapUntrusted('note', note.body) })),
    points: bundle.points.map((point) => ({
      ...point,
      title: wrapUntrusted('point_title', point.title),
      body: wrapUntrusted('point_body', point.body),
      thread: point.thread.map((entry) => ({ ...entry, body: wrapUntrusted('comment', entry.body) })),
    })),
    rules: bundle.rules,
  };
}
