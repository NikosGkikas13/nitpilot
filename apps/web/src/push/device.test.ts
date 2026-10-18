import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceLabel, isIos, isStandalone } from './device';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
};

afterEach(() => vi.unstubAllGlobals());

describe('isIos', () => {
  it('knows an iPhone, and an iPad that asks for the desktop site (a Mac with a touch screen)', () => {
    expect(isIos({ userAgent: UA.safariIphone, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: UA.chromeIphone, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: UA.safariMac, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: UA.safariMac, maxTouchPoints: 0 })).toBe(false);
    expect(isIos({ userAgent: UA.chromeAndroid, maxTouchPoints: 5 })).toBe(false);
  });
});

describe('isStandalone', () => {
  it('is true in the installed app: a standalone window, or an iPhone Home Screen app', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)' }));
    expect(isStandalone()).toBe(true);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(isStandalone()).toBe(false);
    vi.stubGlobal('navigator', { standalone: true });
    expect(isStandalone()).toBe(true);
  });
});

describe('deviceLabel (how Settings will name this browser)', () => {
  it.each([
    ['chromeMac', 0, 'Chrome on macOS'],
    ['safariMac', 0, 'Safari on macOS'],
    ['safariMac', 5, 'Safari on iPad'],
    ['safariIphone', 5, 'Safari on iPhone'],
    ['chromeIphone', 5, 'Chrome on iPhone'],
    ['firefoxWindows', 0, 'Firefox on Windows'],
    ['edgeWindows', 0, 'Edge on Windows'],
    ['chromeAndroid', 5, 'Chrome on Android'],
    ['firefoxLinux', 0, 'Firefox on Linux'],
    ['unknown', 0, 'A browser'],
  ] as const)('%s with %i touch points → %s', (name, maxTouchPoints, label) => {
    const userAgent = name === 'unknown' ? '' : UA[name];
    expect(deviceLabel({ userAgent, maxTouchPoints })).toBe(label);
  });
});
