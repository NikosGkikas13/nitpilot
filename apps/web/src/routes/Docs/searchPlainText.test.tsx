import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Search } from './SearchDialog';
import { searchDocs } from './search';

// A stub page with markup in it: bold text and a code block holding a literal <repo>.
vi.mock('./pages', () => ({
  DOC_PAGES: [{ slug: 'stub', title: 'Stub', group: 'Guides' }],
  pageSource: () => '# Stub\n\nSome **bold** words about the repo.\n\n```bash\ngit clone <repo> now\n```\n',
}));

describe('snippets are plain text', () => {
  it('keeps a literal <repo> but has no tags and no Markdown', () => {
    const [hit] = searchDocs('repo');
    expect(hit!.snippet).toContain('<repo>');
    expect(hit!.snippet.replace('<repo>', '')).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(searchDocs('bold')[0]!.snippet).not.toContain('**');
  });

  it('shows <repo> as text in the dialog, not as an element', async () => {
    const { container } = render(
      <MemoryRouter>
        <Search open onClose={() => {}} />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByRole('combobox'), 'clone');
    expect(screen.getByRole('option')).toHaveTextContent('<repo>');
    expect(container.querySelector('repo')).toBeNull();
  });
});
