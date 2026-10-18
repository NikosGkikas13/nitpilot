/**
 * Chromium's `beforeinstallprompt` event: the browser saying "this site can be installed". Calling `prompt()` opens
 * the browser's own install dialog; it works once per event. Not in TypeScript's DOM types (Chromium only).
 */
export type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * Holds the browser's offer to install the app until the install card (components/InstallCard) uses it. The event can
 * fire as soon as the page has loaded, before anyone is signed in and long before the card is on screen, so main.tsx
 * starts listening at once and the card reads it from here (with `useSyncExternalStore`, like a tiny store).
 */
export class InstallPrompt {
  private event: InstallPromptEvent | null = null;
  private readonly listeners = new Set<() => void>();

  /** Start listening on the window. Returns the function that stops. */
  listen(target: Window): () => void {
    const offered = (e: Event) => {
      // Keep Chromium's own install bar away; the card offers it instead, at a better moment.
      e.preventDefault();
      this.set(e as InstallPromptEvent);
    };
    const installed = () => this.set(null);
    target.addEventListener('beforeinstallprompt', offered);
    target.addEventListener('appinstalled', installed);
    return () => {
      target.removeEventListener('beforeinstallprompt', offered);
      target.removeEventListener('appinstalled', installed);
    };
  }

  /** The offer, or null when there's none (another browser, already installed, or used). */
  readonly current = (): InstallPromptEvent | null => this.event;

  readonly subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  /** Open the browser's install dialog and wait for the answer. The offer is used up either way. */
  async install(): Promise<void> {
    const event = this.event;
    if (!event) return;
    this.set(null);
    await event.prompt();
    await event.userChoice;
  }

  private set(event: InstallPromptEvent | null): void {
    this.event = event;
    for (const listener of this.listeners) listener();
  }
}

/** The one the app uses: main.tsx starts it listening, the install card reads it. */
export const installPrompt = new InstallPrompt();
