import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useInboxKeys } from './keys';

const ROWS = [{ chatId: 'a' }, { chatId: 'b' }, { chatId: 'c' }];

/** A search box and the cursor, driven by the inbox keys. */
function Harness({ open = vi.fn(), escape = vi.fn() }: { open?: (id: string) => void; escape?: () => void }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useInboxKeys({ rows: ROWS, cursor, setCursor, open, focusSearch: () => search.current?.focus(), escape });
  return (
    <>
      <input ref={search} aria-label="Search pull requests" />
      <output aria-label="cursor">{cursor ?? 'none'}</output>
      <main>
        <div tabIndex={0} aria-label="feed" />
      </main>
    </>
  );
}

const cursor = () => screen.getByLabelText('cursor').textContent;

describe('useInboxKeys (handoff "Keyboard")', () => {
  it('moves the cursor with j/k and the arrow keys, and stops at the ends', async () => {
    render(<Harness />);
    await userEvent.keyboard('j');
    expect(cursor()).toBe('a');
    await userEvent.keyboard('j{ArrowDown}j');
    expect(cursor()).toBe('c');
    await userEvent.keyboard('k{ArrowUp}k');
    expect(cursor()).toBe('a');
  });

  it('opens the row under the cursor with Enter, and nothing without a cursor', async () => {
    const open = vi.fn();
    render(<Harness open={open} />);
    await userEvent.keyboard('{Enter}');
    expect(open).not.toHaveBeenCalled();
    await userEvent.keyboard('jj{Enter}');
    expect(open).toHaveBeenCalledWith('b');
  });

  it('focuses the search box with /, and ignores the keys while you type in it', async () => {
    render(<Harness />);
    await userEvent.keyboard('/');
    expect(screen.getByLabelText('Search pull requests')).toHaveFocus();
    await userEvent.keyboard('j');
    expect(cursor()).toBe('none');
    expect(screen.getByLabelText('Search pull requests')).toHaveValue('j');
  });

  it('leaves the search box on Esc, and calls escape when not typing', async () => {
    const escape = vi.fn();
    render(<Harness escape={escape} />);
    await userEvent.keyboard('/');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByLabelText('Search pull requests')).not.toHaveFocus();
    expect(escape).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(escape).toHaveBeenCalledOnce();
  });

  it('leaves ↑/↓ to the page beside the inbox, so its feed scrolls, while j/k still move the cursor', async () => {
    render(<Harness />);
    const feed = screen.getByLabelText('feed');
    feed.focus();
    // fireEvent answers false when the key's default action (scrolling) was cancelled.
    expect(fireEvent.keyDown(feed, { key: 'ArrowDown' })).toBe(true);
    expect(cursor()).toBe('none');
    await userEvent.keyboard('j');
    expect(cursor()).toBe('a');
  });

  it('leaves shortcuts with a modifier (⌘J, Ctrl+K) to the browser', async () => {
    render(<Harness />);
    await userEvent.keyboard('{Meta>}j{/Meta}{Control>}k{/Control}');
    expect(cursor()).toBe('none');
  });
});
