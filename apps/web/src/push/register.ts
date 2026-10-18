/**
 * Install the service worker (public/sw.js, docs/why/service-workers-and-pwa.md) for the whole site. It's what
 * receives a push while no Nitpilot tab is open, and the browser wants one before it offers to install the app.
 *
 * Called once at start (main.tsx), and again by `turnPushOn` in case that failed: registering the same file again is
 * harmless. Answers null in a browser without service workers, or when the browser refuses (a page that isn't on
 * https or localhost): the app works without it, only push and installing don't.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[push] the service worker was not registered:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
