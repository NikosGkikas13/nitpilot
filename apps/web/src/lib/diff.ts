import type { DraftFile } from '@nitpilot/protocol';

/**
 * One line of a file's diff: added, removed, unchanged, a hunk's `@@` header, or a note ("\ No newline at end of
 * file", a rename, a binary file). `n` is its line number: in the new file, or in the old one for a removed line.
 */
export type DiffLine = { kind: 'add' | 'del' | 'context' | 'hunk' | 'note'; n: number | null; text: string };

export type DiffFileView = { path: string; adds: number; dels: number; lines: DiffLine[] };

/**
 * A draft commit's unified diff (`git diff`, spec §11 "Draft mode"), split by file. The path and the counts come
 * from the CLI's file list when a file matches it, whatever prefixes the person's git config gave the diff (`a/` and
 * `b/`, none, or `i/` and `w/`); otherwise the diff's own path and a count of its lines.
 */
export function splitDiff(diff: string, files: DraftFile[]): DiffFileView[] {
  const sections: string[][] = [];
  // The diff ends with a newline; without it, split() would leave an empty last line.
  for (const line of diff.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('diff --git ')) sections.push([line]);
    else sections.at(-1)?.push(line);
  }
  return sections.map((section) => fileView(section, files));
}

function fileView(section: string[], files: DraftFile[]): DiffFileView {
  const lines: DiffLine[] = [];
  let oldN = 0;
  let newN = 0;
  let inHunk = false;
  for (const line of section.slice(1)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      oldN = Number(hunk[1]);
      newN = Number(hunk[2]);
      lines.push({ kind: 'hunk', n: null, text: line });
    } else if (!inHunk) {
      continue; // The file's header: index, ---, +++, modes, renames.
    } else if (line.startsWith('+')) {
      lines.push({ kind: 'add', n: newN++, text: line.slice(1) });
    } else if (line.startsWith('-')) {
      lines.push({ kind: 'del', n: oldN++, text: line.slice(1) });
    } else if (line.startsWith('\\')) {
      lines.push({ kind: 'note', n: null, text: line.slice(2) });
    } else {
      // An unchanged line (an empty one may have lost its leading space on the way).
      lines.push({ kind: 'context', n: newN++, text: line.slice(1) });
      oldN++;
    }
  }
  if (lines.length === 0) lines.push(noLines(section));
  const path = pathOf(section, files);
  const listed = files.find((f) => f.path === path);
  return {
    path,
    adds: listed?.adds ?? lines.filter((l) => l.kind === 'add').length,
    dels: listed?.dels ?? lines.filter((l) => l.kind === 'del').length,
    lines,
  };
}

/** What to say for a file with no lines to show. */
function noLines(section: string[]): DiffLine {
  const renamed = section.find((l) => l.startsWith('rename from '));
  if (renamed) return { kind: 'note', n: null, text: `Renamed from ${unquoteName(renamed.slice('rename from '.length))}` };
  if (section.some((l) => l.startsWith('Binary files '))) return { kind: 'note', n: null, text: 'Binary file, not shown' };
  return { kind: 'note', n: null, text: 'No line changes' };
}

/**
 * The file's path: the `+++` line's (the `---` line's for a deleted file), without git's one-segment prefix, or, for
 * a file with neither (a rename, a binary file), the listed path the `diff --git` line ends with.
 */
function pathOf(section: string[], files: DraftFile[]): string {
  const plus = section.find((l) => l.startsWith('+++ '))?.slice(4).replace(/\t$/, '');
  const minus = section.find((l) => l.startsWith('--- '))?.slice(4).replace(/\t$/, '');
  const quotedName = plus && plus !== '/dev/null' ? plus : minus && minus !== '/dev/null' ? minus : null;
  const named = quotedName === null ? null : unquoteName(quotedName);
  if (named) {
    const unprefixed = named.replace(/^[^/]+\//, '');
    if (files.some((f) => f.path === named)) return named;
    if (files.some((f) => f.path === unprefixed)) return unprefixed;
    return /^[a-z]\//.test(named) ? unprefixed : named;
  }
  const header = unquoteHeader(section[0]!);
  const ends = files.filter((f) => header.endsWith(` ${f.path}`) || header.endsWith(`/${f.path}`)).sort((a, b) => b.path.length - a.path.length);
  return ends[0]?.path ?? header.slice('diff --git '.length).split(' ').at(-1)!.replace(/^[a-z]\//, '');
}

const GIT_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * A name as git prints it when it has characters git "quotes" (a non-ASCII letter, a tab, a quote): in double quotes,
 * with C-style escapes (`\t`, `\"`) and `\303\251`-style octal bytes, which together spell the name in UTF-8. The CLI's file
 * list has the raw name (`git diff --numstat -z`), so the patch's names are turned back into it to match. A name that
 * isn't quoted comes back as it is.
 */
function unquoteName(name: string): string {
  if (name.length < 2 || !name.startsWith('"') || !name.endsWith('"')) return name;
  const inner = name.slice(1, -1);
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    const octal = /^[0-7]{3}/.exec(inner.slice(i + 1, i + 4));
    if (ch !== '\\') bytes.push(...encoder.encode(ch));
    else if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (inner[i + 1] !== undefined && GIT_ESCAPES[inner[i + 1]!] !== undefined) {
      bytes.push(GIT_ESCAPES[inner[i + 1]!]!);
      i += 1;
    } else bytes.push(92); // A backslash git didn't escape: keep it.
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** The `diff --git` line with each quoted name in it turned back into the name itself. */
function unquoteHeader(header: string): string {
  return header.replace(/"(?:[^"\\]|\\.)*"/g, (quoted) => unquoteName(quoted));
}
