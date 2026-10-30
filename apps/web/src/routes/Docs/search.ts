import { renderMarkdown, type Heading } from './markdown';
import { DOC_PAGES, pageSource } from './pages';

export type SearchHit = { slug: string; pageTitle: string; heading?: Heading; snippet: string };

/** One searchable slice of a page: the text before the first heading, or the text under one heading. */
type Section = { slug: string; pageTitle: string; heading?: Heading; text: string };

let index: Section[] | undefined;

/** Splits every page into sections of plain text. Built on first use, then kept: the pages never change while the app runs. */
function getIndex(): Section[] {
  if (index) return index;
  const sections: Section[] = [];
  for (const { slug, title } of DOC_PAGES) {
    const source = pageSource(slug);
    if (!source) continue;
    const { html, headings } = renderMarkdown(source);
    const body = new DOMParser().parseFromString(html, 'text/html').body;
    let current: Section = { slug, pageTitle: title, text: '' };
    sections.push(current);
    for (const node of Array.from(body.children)) {
      if (node.tagName === 'H2' || node.tagName === 'H3') {
        current = { slug, pageTitle: title, heading: headings.find((h) => h.id === node.id), text: '' };
        sections.push(current);
        continue;
      }
      node.querySelectorAll('button').forEach((b) => b.remove()); // the code blocks' Copy buttons aren't content
      current.text += ` ${node.textContent}`;
    }
  }
  index = sections.map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() }));
  return index;
}

/** Up to 120 characters of `text`, starting a little before the first place `word` appears. */
function snippetAround(text: string, word: string): string {
  const at = text.toLowerCase().indexOf(word);
  const start = Math.max(0, at - 40);
  return text.slice(start, start + 120).trim();
}

/** Case-insensitive; every word of the query must appear. Page-title matches come first, then heading matches, then body text. */
export function searchDocs(query: string, limit = 8): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = (haystack: string) => words.every((w) => haystack.toLowerCase().includes(w));

  const ranked: { rank: number; section: Section }[] = [];
  for (const section of getIndex()) {
    // The section before the first heading stands for the page itself.
    if (!section.heading && matches(section.pageTitle)) ranked.push({ rank: 0, section });
    else if (section.heading && matches(section.heading.text)) ranked.push({ rank: 1, section });
    else if (matches(section.text)) ranked.push({ rank: 2, section });
  }
  // Array.sort is stable, so equal ranks stay in sidebar order.
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.slice(0, limit).map(({ section }) => ({
    slug: section.slug,
    pageTitle: section.pageTitle,
    heading: section.heading,
    snippet: snippetAround(section.text, words[0]!),
  }));
}
