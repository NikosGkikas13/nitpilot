import { describe, expect, it } from 'vitest';
import { searchDocs } from './search';

describe('searchDocs', () => {
  it('returns nothing for an empty, blank or unmatched query', () => {
    expect(searchDocs('')).toEqual([]);
    expect(searchDocs('   ')).toEqual([]);
    expect(searchDocs('zzzz-no-match')).toEqual([]);
  });

  it('ranks a page-title match first, with no heading', () => {
    const [first] = searchDocs('introduction');
    expect(first?.slug).toBe('introduction');
    expect(first?.heading).toBeUndefined();
  });

  it('returns the heading id when only a heading matches', () => {
    const hits = searchDocs('try it');
    expect(hits[0]?.heading).toEqual({ id: 'try-it', text: 'Try it', depth: 2 });
  });

  it('finds body text, needs every word, and ignores case', () => {
    expect(searchDocs('NPM install')[0]?.heading?.id).toBe('try-it');
    expect(searchDocs('npm pizza')).toEqual([]);
  });

  it('gives short plain-text snippets', () => {
    for (const q of ['introduction', 'try it', 'npm', 'review']) {
      for (const hit of searchDocs(q)) {
        expect(hit.snippet.length).toBeLessThanOrEqual(120);
        expect(hit.snippet).not.toContain('<');
      }
    }
  });
});
