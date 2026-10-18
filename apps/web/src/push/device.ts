/** What these functions read from `navigator`; tests pass their own. */
type Device = Pick<Navigator, 'userAgent' | 'maxTouchPoints'>;

/**
 * An iPhone or iPad. iPadOS asks for the desktop site by default and then says it's a Mac, so a "Mac" with a touch
 * screen is an iPad too. Every browser on iOS (Safari, Chrome, Firefox) follows the same Home Screen rule.
 */
export function isIos(device: Device = navigator): boolean {
  if (/iPhone|iPad|iPod/.test(device.userAgent)) return true;
  return /Macintosh/.test(device.userAgent) && device.maxTouchPoints > 1;
}

/**
 * True inside the installed app: its own window (`display-mode: standalone`, from the manifest), or on iOS the app
 * opened from the Home Screen (Safari's own `navigator.standalone`).
 */
export function isStandalone(): boolean {
  if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** The browser's name, from its user agent. The order matters: Edge says Chrome too, and Chrome says Safari. */
function browserName(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return null;
}

function systemName(device: Device): string | null {
  const ua = device.userAgent;
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (isIos(device)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

/**
 * A name for this browser's push subscription, "Chrome on macOS", so a list of them (Settings) can tell your laptop
 * from your phone. A guess from the user agent, never trusted for anything else.
 */
export function deviceLabel(device: Device = navigator): string {
  const browser = browserName(device.userAgent);
  const system = systemName(device);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'A browser';
}
