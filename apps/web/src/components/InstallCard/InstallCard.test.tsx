import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallPrompt } from '../../push/install';
import { INSTALL_DISMISSED_KEY, InstallCard } from './InstallCard';

/** What Chrome fires when the app can be installed: an event whose `prompt()` opens the browser's own dialog. */
function fireInstallable(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  act(() => void window.dispatchEvent(event));
  return event;
}

let stop: () => void = () => {};
let prompt: InstallPrompt;

beforeEach(() => {
  localStorage.clear();
  prompt = new InstallPrompt();
  stop = prompt.listen(window);
});

afterEach(() => {
  stop();
  vi.unstubAllGlobals();
});

describe('InstallCard (handoff §9 "Desktop install prompt")', () => {
  it('shows nothing until the browser says the app can be installed', () => {
    render(<InstallCard prompt={prompt} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("keeps the browser's own install bar away, and offers its card instead", () => {
    render(<InstallCard prompt={prompt} />);
    const event = fireInstallable();
    expect(event.defaultPrevented).toBe(true);
    const card = screen.getByRole('dialog', { name: 'Install Nitpilot' });
    expect(card).toHaveAccessibleDescription("Its own window next to your editor, with notifications when you're needed.");
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it("an event that came before the card was on screen still counts (it fires early, before you're signed in)", () => {
    fireInstallable();
    render(<InstallCard prompt={prompt} />);
    expect(screen.getByRole('dialog', { name: 'Install Nitpilot' })).toBeInTheDocument();
  });

  it("Install opens the browser's dialog, once, and the card goes", async () => {
    render(<InstallCard prompt={prompt} />);
    const event = fireInstallable('dismissed');
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Turning the browser's dialog down isn't "Not now": the card may come back when the browser asks again.
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBeNull();
  });

  it('Not now hides the card and is remembered', async () => {
    const { unmount } = render(<InstallCard prompt={prompt} />);
    fireInstallable();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();
    render(<InstallCard prompt={prompt} />);
    fireInstallable();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Not now still hides the card when the browser keeps no site data', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    render(<InstallCard prompt={prompt} />);
    fireInstallable();
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes once the app is installed, and never shows inside the installed app', () => {
    render(<InstallCard prompt={prompt} />);
    fireInstallable();
    act(() => void window.dispatchEvent(new Event('appinstalled')));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)', addEventListener: () => {}, removeEventListener: () => {} }));
    fireInstallable();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
