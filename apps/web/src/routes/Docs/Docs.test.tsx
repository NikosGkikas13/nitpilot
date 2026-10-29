import { BRAND } from '@nitpilot/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN_URL } from '../Landing/Landing';
import { Docs } from './Docs';

const fetchMock = vi.fn();

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="docs" element={<Docs />} />
        <Route path="docs/:slug" element={<Docs />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

describe('Docs', () => {
  it('shows the introduction at /docs, marks it current and sets the title', () => {
    renderAt('/docs');
    expect(screen.getByRole('heading', { level: 1, name: 'Introduction' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Introduction' })).toHaveAttribute('aria-current', 'page');
    expect(document.title).toBe('Introduction · Nitpilot docs');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows "Page not found" for an unknown page, with a way back', () => {
    renderAt('/docs/quickstrat');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Introduction' });
    expect(links.every((link) => link.getAttribute('href') === '/docs')).toBe(true);
    expect(links.length).toBeGreaterThan(1); // the sidebar's and the one in the message
  });

  it('follows a link in the page body inside the app', () => {
    const { container } = renderAt('/docs');
    expect(screen.getByTestId('where').textContent).toBe('/docs');
    const link = container.querySelector('main a[href^="/docs"]')!;
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false); // the page didn't reload
    expect(screen.getByTestId('where').textContent).toBe('/docs/introduction');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('copies a code block and says Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { container } = renderAt('/docs');
    const button = container.querySelector('button[data-copy]')!;
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith(container.querySelector('pre')!.textContent);
    expect(button).toHaveTextContent('Copied');
  });

  it('puts the tab title back when you leave the docs', () => {
    document.title = 'Nitpilot';
    const { unmount } = renderAt('/docs');
    expect(document.title).toBe('Introduction · Nitpilot docs');
    unmount();
    expect(document.title).toBe('Nitpilot');
  });

  it('has the top bar links and the theme toggle', () => {
    renderAt('/docs');
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', '/docs');
    expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', BRAND.repoUrl);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', SIGN_IN_URL);
    expect(screen.getByRole('button', { name: /theme/ })).toBeInTheDocument();
  });
});
