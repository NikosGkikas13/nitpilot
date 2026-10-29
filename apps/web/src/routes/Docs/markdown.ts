import { Marked } from 'marked';

export type Heading = { id: string; text: string; depth: 2 | 3 };

/** "Use GitHub Copilot CLI" -> "use-github-copilot-cli": the id a heading gets, so `#use-github-copilot-cli` links work. */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The words of a rendered heading: tags dropped, entities turned back into characters. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Turns one Markdown page into HTML. The first `# ` line is the page title and is left out of the HTML (the layout draws
 * it); `##` and `###` get ids and are listed in `headings`; each code block gets a Copy button that Docs.tsx wires up.
 */
export function renderMarkdown(source: string): { title: string; html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plainText(inner);
        if (depth !== 2 && depth !== 3) return `<h${depth}>${inner}</h${depth}>\n`;
        const base = slugify(text);
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        const id = count === 1 ? base : `${base}-${count}`;
        headings.push({ id, text, depth });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      code({ text }) {
        return `<div class="code"><button type="button" data-copy>Copy</button><pre><code>${escapeHtml(text)}\n</code></pre></div>\n`;
      },
    },
  });

  const titleLine = /^# (.+)$/m.exec(source);
  const body = titleLine ? source.replace(titleLine[0], '') : source;
  return { title: titleLine?.[1]?.trim() ?? '', html: marked.parse(body, { async: false }), headings };
}
