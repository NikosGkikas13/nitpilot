import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './register';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerServiceWorker', () => {
  it('registers /sw.js for the whole site', async () => {
    const registration = { scope: 'http://localhost/' };
    const register = vi.fn(async () => registration);
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    expect(await registerServiceWorker()).toBe(registration);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('answers null in a browser without service workers', async () => {
    vi.stubGlobal('navigator', {});
    expect(await registerServiceWorker()).toBeNull();
  });

  it('answers null, and says why in the console, when the browser refuses (the app works without it)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => Promise.reject(new Error('SecurityError: insecure origin'))) } });
    expect(await registerServiceWorker()).toBeNull();
    expect(warn).toHaveBeenCalledWith('[push] the service worker was not registered:', 'SecurityError: insecure origin');
  });
});
