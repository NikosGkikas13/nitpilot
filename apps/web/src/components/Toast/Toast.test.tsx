import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, Toasts, TOAST_MS, useToast } from './Toast';

/** A page with the toast's place and two buttons that show one. */
function Page() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.show("Sent. Included in the agents' next round.")}>
        plain
      </button>
      <button type="button" onClick={() => toast.show('P1 is already resolved.', { error: true })}>
        error
      </button>
      <Toasts />
    </>
  );
}

afterEach(() => vi.useRealTimers());

describe('Toast (handoff "Toasts")', () => {
  it('says what happened in a status line, and goes after 2.6 s', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>,
    );
    act(() => screen.getByRole('button', { name: 'plain' }).click());
    expect(screen.getByRole('status')).toHaveTextContent("Sent. Included in the agents' next round.");
    expect(TOAST_MS).toBe(2600);
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.getByRole('status')).toHaveTextContent('Sent.');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('shows an error with the red diamond, and a new toast replaces the old one with a full 2.6 s of its own', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>,
    );
    act(() => screen.getByRole('button', { name: 'plain' }).click());
    act(() => vi.advanceTimersByTime(2000));
    act(() => screen.getByRole('button', { name: 'error' }).click());
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('P1 is already resolved.');
    expect(status).not.toHaveTextContent('Sent.');
    expect(status.querySelector('[data-error]')).not.toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(status).toHaveTextContent('P1 is already resolved.');
    act(() => vi.advanceTimersByTime(600));
    expect(status).toBeEmptyDOMElement();
  });
});
