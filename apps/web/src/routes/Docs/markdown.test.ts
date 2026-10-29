import { describe, expect, it } from 'vitest';
import { renderMarkdown, slugify } from './markdown';

describe('slugify', () => {
  it('lower-cases and joins words with dashes', () => {
    expect(slugify('Use GitHub Copilot CLI')).toBe('use-github-copilot-cli');
    expect(slugify('  config.json? ')).toBe('config-json');
  });
});

describe('renderMarkdown', () => {
  it('takes the title out of the body and numbers repeated heading ids', () => {
    const { title, html, headings } = renderMarkdown('# Intro\n\nHi\n\n## Try it\n\n### Step one\n\n## Try it');
    expect(title).toBe('Intro');
    expect(html).not.toContain('<h1');
    expect(headings).toEqual([
      { id: 'try-it', text: 'Try it', depth: 2 },
      { id: 'step-one', text: 'Step one', depth: 3 },
      { id: 'try-it-2', text: 'Try it', depth: 2 },
    ]);
    expect(html).toContain('<h2 id="try-it-2">');
  });

  it('wraps a code block with a Copy button and escapes the command', () => {
    const { html } = renderMarkdown('# T\n\n```bash\necho "<b>" > out\n```');
    const box = new DOMParser().parseFromString(html, 'text/html').querySelector('div.code')!;
    expect(box.querySelector('button[data-copy]')).not.toBeNull();
    expect(box.querySelector('pre code')!.textContent).toBe('echo "<b>" > out\n');
    expect(html).toContain('&lt;b&gt;');
  });
});
