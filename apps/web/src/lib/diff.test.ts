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

  it('has no files for an empty diff', () => {
    expect(splitDiff('', [])).toEqual([]);
  });
});
