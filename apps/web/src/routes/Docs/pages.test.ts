import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import { DOC_PAGES, neighbours, pageSource } from './pages';

const files = import.meta.glob('./pages/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('docs pages', () => {
  it('every page in the list has a Markdown file whose title matches', () => {
    for (const page of DOC_PAGES) {
      const source = pageSource(page.slug);
      expect(source, page.slug).toBeDefined();
      expect(renderMarkdown(source!).title, page.slug).toBe(page.title);
    }
  });

  it('every Markdown file is in the list', () => {
    const slugs = Object.keys(files).map((path) => path.replace('./pages/', '').replace(/\.md$/, ''));
    expect(slugs.sort()).toEqual(DOC_PAGES.map((page) => page.slug).sort());
  });

  it('links between pages name a real page and heading', () => {
    for (const [path, source] of Object.entries(files)) {
      expect(source, path).not.toMatch(/\]\((?:\.\/)?docs\//);
      expect(source, path).not.toMatch(/\]\([^)]*\.md[)#]/);
      for (const [, slug, anchor] of source.matchAll(/\]\(\/docs\/([a-z0-9-]+)(?:#([a-z0-9-]+))?\)/g)) {
        const target = pageSource(slug!);
        expect(target, `${path} -> ${slug}`).toBeDefined();
        if (anchor) {
          const ids = renderMarkdown(target!).headings.map((heading) => heading.id);
          expect(ids, `${path} -> ${slug}#${anchor}`).toContain(anchor);
        }
      }
    }
  });

  it('has no previous page before the first one', () => {
    expect(neighbours('introduction').prev).toBeUndefined();
  });
});
