export const DOC_GROUPS = ['Get started', 'Guides', 'Reference', 'Help', 'Under the hood'] as const;
export type DocGroup = (typeof DOC_GROUPS)[number];

export type DocPage = { slug: string; title: string; group: DocGroup };

/** Every docs page in sidebar order. The Markdown for each lives in `pages/<slug>.md`. */
export const DOC_PAGES: DocPage[] = [{ slug: 'introduction', title: 'Introduction', group: 'Get started' }];

// Vite reads each Markdown file as text at build time, so the pages ship inside the docs chunk.
const SOURCES = import.meta.glob('./pages/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function findPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export function pageSource(slug: string): string | undefined {
  return SOURCES[`./pages/${slug}.md`];
}

/** The pages either side of this one, in sidebar order. */
export function neighbours(slug: string): { prev?: DocPage; next?: DocPage } {
  const i = DOC_PAGES.findIndex((page) => page.slug === slug);
  if (i === -1) return {};
  return { prev: DOC_PAGES[i - 1], next: DOC_PAGES[i + 1] };
}
