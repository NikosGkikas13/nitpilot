import { describe, expect, it } from 'vitest';
import { snippetLines, syntaxTokens } from './snippet';

describe('snippetLines', () => {
  it("numbers the lines from where the snippet starts, and highlights the point's line", () => {
    const lines = snippetLines({ line: 48, snippet: { startLine: 43, lines: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } });
    expect(lines.map((l) => l.n)).toEqual([43, 44, 45, 46, 47, 48, 49]);
    expect(lines.filter((l) => l.highlighted)).toEqual([{ n: 48, text: 'f', highlighted: true }]);
  });

  it('highlights nothing for a point about the whole file, and has no lines without a snippet', () => {
    expect(snippetLines({ line: null, snippet: { startLine: 1, lines: ['a'] } })).toEqual([{ n: 1, text: 'a', highlighted: false }]);
    expect(snippetLines({ line: 3, snippet: null })).toEqual([]);
  });
});

describe('syntaxTokens', () => {
  it('colours keywords, strings, numbers and comments, and leaves the rest plain', () => {
    expect(syntaxTokens('const n = "25"; // page size')).toEqual([
      { text: 'const', kind: 'keyword' },
      { text: ' n = ', kind: 'plain' },
      { text: '"25"', kind: 'string' },
      { text: '; ', kind: 'plain' },
      { text: '// page size', kind: 'comment' },
    ]);
    expect(syntaxTokens('  return 25;')).toEqual([{ text: '  ', kind: 'plain' }, { text: 'return', kind: 'keyword' }, { text: ' ', kind: 'plain' }, { text: '25', kind: 'number' }, { text: ';', kind: 'plain' }]);
    expect(syntaxTokens('')).toEqual([]);
  });
});
