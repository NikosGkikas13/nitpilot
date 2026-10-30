import { BRAND } from '@nitpilot/protocol';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN_URL } from '../Landing/Landing';
import { Docs } from './Docs';

const fetchMock = vi.fn();
const scrollIntoView = vi.fn(); // jsdom has no scrollIntoView
const scrollTo = vi.fn();

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function BackButton() {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(-1)}>test-back</button>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="docs/*" element={<Docs />} />
      </Routes>
      <Where />
      <BackButton />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
  scrollIntoView.mockClear();
  scrollTo.mockClear();
  vi.restoreAllMocks();
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
    expect(screen.getByTestId('where').textContent).toBe('/docs/quickstart');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('copies a code block without its trailing newline and says Copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { container } = renderAt('/docs');
    const button = container.querySelector('button[data-copy]')!;
    fireEvent.click(button);
    const code = container.querySelector('pre')!.textContent!;
    expect(code.endsWith('\n')).toBe(true);
    expect(writeText).toHaveBeenCalledWith(code.trimEnd());
    await waitFor(() => expect(button).toHaveTextContent('Copied'));
  });

  it('keeps saying Copy when the clipboard is missing or refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    const { container, unmount } = renderAt('/docs');
    fireEvent.click(container.querySelector('button[data-copy]')!);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(container.querySelector('button[data-copy]')).toHaveTextContent('Copy');
    unmount();

    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const second = renderAt('/docs');
    const button = second.container.querySelector('button[data-copy]')!;
    fireEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(writeText).toHaveBeenCalled();
    expect(button).toHaveTextContent('Copy');
    expect(button).not.toHaveTextContent('Copied');
  });

  it('shows "Page not found" for a deeper path, without any fetch', () => {
    renderAt('/docs/why/webhooks.md');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('scrolls to the top when a link opens another page, but not on Back', () => {
    renderAt('/docs');
    scrollTo.mockClear();
    fireEvent.click(document.querySelector('main a[href^="/docs"]')!);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    scrollTo.mockClear();
    fireEvent.click(screen.getByText('test-back'));
    expect(scrollTo).not.toHaveBeenCalled(); // the browser restores the old position
  });

  it('scrolls again when you choose the heading you are already on', () => {
    renderAt('/docs/introduction#try-it');
    scrollIntoView.mockClear();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'try it' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
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
    expect(within(screen.getByRole('banner')).getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', BRAND.repoUrl);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', SIGN_IN_URL);
    expect(screen.getByRole('button', { name: /theme/ })).toBeInTheDocument();
  });

  it('has a GitHub link in the sidebar, for phones where the top bar hides it', () => {
    renderAt('/docs');
    const nav = screen.getByRole('navigation', { name: 'Docs pages' });
    expect(within(nav).getByRole('link', { name: /^GitHub/ })).toHaveAttribute('href', BRAND.repoUrl);
  });

  it('scrolls to the heading named in the URL hash', () => {
    renderAt('/docs/introduction#try-it');
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts[0]).toHaveProperty('id', 'try-it');
  });

  it('opens and closes the page list with the Menu button', () => {
    renderAt('/docs');
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('navigation', { name: 'Docs pages' }).querySelector('a')!);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  it('does not crash on a malformed hash', () => {
    renderAt('/docs#%');
    expect(screen.getByRole('heading', { level: 1, name: 'Introduction' })).toBeInTheDocument();
  });

  it('moves focus to the page when a sidebar link closes the menu', () => {
    renderAt('/docs');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    fireEvent.click(screen.getByRole('navigation', { name: 'Docs pages' }).querySelector('a')!);
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('closes the menu when the page changes', () => {
    renderAt('/docs');
    const menu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(document.querySelector('main a[href^="/docs"]')!); // goes /docs -> /docs/quickstart
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByText('test-back'));
    expect(screen.getByTestId('where').textContent).toBe('/docs');
    expect(menu).toHaveAttribute('aria-expanded', 'false'); // Back must not reopen it
  });

  it('closes the menu on Escape and returns focus to the Menu button', () => {
    renderAt('/docs');
    const menu = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(menu);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
  });

  it('opens search with Cmd-K and gives focus back when it closes', () => {
    renderAt('/docs');
    const opener = screen.getByRole('button', { name: 'Search docs' });
    opener.focus();
    fireEvent.click(opener);
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    // Plain letters do nothing, even inside the dialog.
    fireEvent.keyDown(input, { key: 'k' });
    expect(screen.getByRole('dialog', { name: 'Search docs' })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(screen.getByRole('dialog', { name: 'Search docs' })).toBeInTheDocument();
  });

  it('opens search with Ctrl-K, and a plain k does nothing', () => {
    renderAt('/docs');
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'K', ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('returns focus to the search button when the opener never had focus (Safari)', () => {
    renderAt('/docs');
    const opener = screen.getByRole('button', { name: 'Search docs' });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(opener); // a click that leaves focus on <body>
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('moves focus to the page after a search result is opened', () => {
    renderAt('/docs/introduction');
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'try it' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('/docs');
    expect(document.querySelector('main')).toHaveFocus();
  });

  it('moves focus to the page after a search result is clicked', () => {
    renderAt('/docs/introduction');
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'behind another https proxy' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    fireEvent.click(options[0].querySelector('a')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('main')).toHaveFocus();
  });
});
