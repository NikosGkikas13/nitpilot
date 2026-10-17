import type { PointView } from '@nitpilot/protocol';

/** One line of a point's code snippet: its number, its text, and whether the point is about it. */
export type SnippetLine = { n: number; text: string; highlighted: boolean };

/** The lines of a point's snippet, numbered from where it starts, with the point's own line highlighted (handoff §3). */
export function snippetLines(point: Pick<PointView, 'snippet' | 'line'>): SnippetLine[] {
  const snippet = point.snippet;
  if (!snippet) return [];
  return snippet.lines.map((text, i) => {
    const n = snippet.startLine + i;
    return { n, text, highlighted: n === point.line };
  });
}

export type TokenKind = 'plain' | 'comment' | 'string' | 'keyword' | 'number';
export type Token = { text: string; kind: TokenKind };

/** Comments, strings, a few common keywords, and numbers: enough for the light colouring the handoff asks for. */
const TOKENS = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(export|function|const|let|var|return|await|async|new|if|else|for|while|import|from|throw|null|undefined|true|false|class|def|fn|type|interface)\b|(\b\d+(?:\.\d+)?\b)/g;

/**
 * A line of code cut into coloured pieces (handoff §3 "Light syntax colors": keywords acc-text, strings ok-fg,
 * numbers warn-fg, comments fg3). Any language: it only knows what most of them share.
 */
export function syntaxTokens(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKENS)) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index), kind: 'plain' });
    tokens.push({ text: m[0], kind: m[1] ? 'comment' : m[2] ? 'string' : m[3] ? 'keyword' : 'number' });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), kind: 'plain' });
  return tokens;
}
