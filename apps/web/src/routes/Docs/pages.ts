export const DOC_GROUPS = ['Get started', 'Guides', 'Reference', 'Help', 'Under the hood'] as const;
export type DocGroup = (typeof DOC_GROUPS)[number];

export type DocPage = { slug: string; title: string; group: DocGroup };

/** Every docs page in sidebar order. The Markdown for each lives in `pages/<slug>.md`. */
export const DOC_PAGES: DocPage[] = [
  { slug: 'introduction', title: 'Introduction', group: 'Get started' },
  { slug: 'quickstart', title: 'Quickstart', group: 'Get started' },
  { slug: 'how-it-works', title: 'How it works', group: 'Get started' },
  { slug: 'copilot-cli', title: 'Use GitHub Copilot CLI', group: 'Guides' },
  { slug: 'teammate-on-nitpilot', title: 'When your teammate is on it too', group: 'Guides' },
  { slug: 'settings', title: 'Settings & Auto-review', group: 'Guides' },
  { slug: 'self-hosting', title: 'Self-hosting', group: 'Guides' },
  { slug: 'cli', title: 'CLI commands', group: 'Reference' },
  { slug: 'config-json', title: 'config.json', group: 'Reference' },
  { slug: 'security', title: 'Security', group: 'Reference' },
  { slug: 'troubleshooting', title: 'Troubleshooting', group: 'Help' },
  { slug: 'limits-and-faq', title: 'Limits & FAQ', group: 'Help' },
  { slug: 'changelog', title: 'Changelog', group: 'Help' },
  { slug: 'architecture', title: 'Architecture', group: 'Under the hood' },
  { slug: 'writing-an-adapter', title: 'Writing an adapter', group: 'Under the hood' },
];

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

/** The address of a page: the introduction lives at `/docs`, the rest at `/docs/<slug>`. */
export function pagePath(slug: string): string {
  return slug === 'introduction' ? '/docs' : `/docs/${slug}`;
}
