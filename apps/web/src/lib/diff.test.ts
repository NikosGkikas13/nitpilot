import { describe, expect, it } from 'vitest';
import { splitDiff } from './diff';

const TWO_FILES = [
  'diff --git a/src/orders.ts b/src/orders.ts',
  'index 1111111..2222222 100644',
  '--- a/src/orders.ts',
  '+++ b/src/orders.ts',
  '@@ -10,3 +10,3 @@ export function list() {',
  ' const a = 1;',
  '-export const pageSize = 100;',
  '+export const pageSize = 25;',
  ' const b = 2;',
  'diff --git a/test/orders.test.ts b/test/orders.test.ts',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/test/orders.test.ts',
  '@@ -0,0 +1,2 @@',
  "+import { pageSize } from '../src/orders';",
  '+it("is 25", () => expect(pageSize).toBe(25));',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('splitDiff', () => {
  it('splits a unified diff by file, with each line marked and numbered', () => {
    const files = splitDiff(TWO_FILES, [
      { path: 'src/orders.ts', adds: 1, dels: 1 },
      { path: 'test/orders.test.ts', adds: 2, dels: 0 },
    ]);
    expect(files.map((f) => [f.path, f.adds, f.dels])).toEqual([
      ['src/orders.ts', 1, 1],
      ['test/orders.test.ts', 2, 0],
    ]);
    expect(files[0]!.lines).toEqual([
      { kind: 'hunk', n: null, text: '@@ -10,3 +10,3 @@ export function list() {' },
      { kind: 'context', n: 10, text: 'const a = 1;' },
      { kind: 'del', n: 11, text: 'export const pageSize = 100;' },
      { kind: 'add', n: 11, text: 'export const pageSize = 25;' },
      { kind: 'context', n: 12, text: 'const b = 2;' },
    ]);
    expect(files[1]!.lines.map((l) => [l.kind, l.n])).toEqual([['hunk', null], ['add', 1], ['add', 2], ['note', null]]);
  });

  it('finds the file whatever prefixes git was told to use, and counts lines itself when the file list lacks one', () => {
    const noPrefix = TWO_FILES.replaceAll('a/src', 'src').replaceAll('b/src', 'src');
    expect(splitDiff(noPrefix, [{ path: 'src/orders.ts', adds: 1, dels: 1 }])[0]!.path).toBe('src/orders.ts');
    const mnemonic = TWO_FILES.replaceAll('a/src', 'i/src').replaceAll('b/src', 'w/src');
    expect(splitDiff(mnemonic, [])[0]).toMatchObject({ path: 'src/orders.ts', adds: 1, dels: 1 });
  });

  it('says what changed for a file with no lines to show: a rename, a binary file', () => {
    const diff = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
      'diff --git a/logo.png b/logo.png',
      'index 4444444..5555555 100644',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    const files = splitDiff(diff, [
      { path: 'new.ts', adds: 0, dels: 0 },
      { path: 'logo.png', adds: 0, dels: 0 },
    ]);
    expect(files.map((f) => [f.path, f.lines])).toEqual([
      ['new.ts', [{ kind: 'note', n: null, text: 'Renamed from old.ts' }]],
      ['logo.png', [{ kind: 'note', n: null, text: 'Binary file, not shown' }]],
    ]);
  });

  it("reads git's quoted names (non-ASCII) and the tab git puts after a name with spaces, as the file list spells them", () => {
    const quoted = [
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
      'index 1111111..2222222 100644',
      '--- "a/caf\\303\\251.txt"',
      '+++ "b/caf\\303\\251.txt"',
      '@@ -1 +1,2 @@',
      ' menu',
      '+tea',
      '+cake',
      'diff --git a/my notes.md b/my notes.md',
      'index 3333333..4444444 100644',
      '--- a/my notes.md\t',
      '+++ b/my notes.md\t',
      '@@ -1,2 +1 @@',
      '-old',
      ' keep',
    ].join('\n');
    const files = splitDiff(quoted, [
      { path: 'café.txt', adds: 7, dels: 3 },
      { path: 'my notes.md', adds: 5, dels: 4 },
    ]);
    // The counts are the listed ones (7 and 3, 5 and 4), not recounted from the lines: the path matched the list.
    expect(files.map((f) => [f.path, f.adds, f.dels])).toEqual([
      ['café.txt', 7, 3],
      ['my notes.md', 5, 4],
    ]);
  });

  it('unquotes the escapes git uses in a name, in the header too (a rename or a binary file has no ---/+++ lines)', () => {
    const diff = [
      'diff --git "a/old caf\\303\\251.png" "b/new \\"q\\" caf\\303\\251.png"',
      'similarity index 100%',
      'rename from "old caf\\303\\251.png"',
      'rename to "new \\"q\\" caf\\303\\251.png"',
    ].join('\n');
    const [file] = splitDiff(diff, [{ path: 'new "q" café.png', adds: 0, dels: 0 }]);
    expect(file!.path).toBe('new "q" café.png');
    expect(file!.lines).toEqual([{ kind: 'note', n: null, text: 'Renamed from old café.png' }]);
  });

  it('has no files for an empty diff', () => {
    expect(splitDiff('', [])).toEqual([]);
  });
});
