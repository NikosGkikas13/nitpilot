import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Search } from './SearchDialog';

function Where() {
  const { pathname, hash } = useLocation();
  return <div data-testid="where">{pathname + hash}</div>;
}

function setup(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/docs']}>
      <Search open onClose={onClose} />
      <Where />
    </MemoryRouter>,
  );
  return onClose;
}

describe('Search', () => {
  it('renders nothing while closed', () => {
    render(
      <MemoryRouter>
        <Search open={false} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('focuses the input and says "No results" for a miss', async () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Search docs' })).toBeInTheDocument();
    const input = screen.getByRole('combobox');
    expect(input).toHaveFocus();
    await userEvent.type(input, 'zzzz');
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('opens the first hit with Enter, in-app, and closes', async () => {
    const onClose = setup();
    await userEvent.type(screen.getByRole('combobox'), 'try it{Enter}');
    expect(screen.getByTestId('where').textContent).toBe('/docs#try-it');
    expect(onClose).toHaveBeenCalled();
  });

  it('moves with the arrow keys', async () => {
    setup();
    await userEvent.type(screen.getByRole('combobox'), 'install');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}{ArrowUp}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('closes on Escape and when a result is clicked', async () => {
    const onClose = setup();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByRole('combobox'), 'intro');
    await userEvent.click(screen.getAllByRole('option')[0]!.querySelector('a')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
