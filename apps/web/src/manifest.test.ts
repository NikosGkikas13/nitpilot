// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BRAND } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';

/** A file of the web app, by its path from apps/web. */
const file = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
/** Where a URL path of the site comes from: public/ is copied to the root of dist as it is. */
const publicFile = (urlPath: string) => file(`public${urlPath}`);

type Icon = { src: string; sizes: string; type: string; purpose: string };
const manifest = JSON.parse(readFileSync(publicFile('/manifest.webmanifest'), 'utf8')) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Icon[];
};

/** A PNG's width and height, from its header (the IHDR chunk always comes first). */
function pngSize(path: string): [number, number] {
  const png = readFileSync(path);
  expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

/** True when the PNG has an alpha channel (colour type 4 or 6). */
function pngHasAlpha(path: string): boolean {
  const colourType = readFileSync(path)[25];
  return colourType === 4 || colourType === 6;
}

describe('the web app manifest (public/manifest.webmanifest)', () => {
  it("names the app from BRAND, opens the inbox in its own window, in the handoff's teal", () => {
    expect(manifest.name).toBe(BRAND.name);
    expect(manifest.short_name).toBe(BRAND.name);
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#16707f');
    expect(manifest.background_color).toBe('#16707f');
  });

  it('lists a 192 and a 512 icon and a maskable one, each a file of that size', () => {
    const purposes = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`);
    expect(purposes).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(existsSync(publicFile(icon.src)), icon.src).toBe(true);
      expect(pngSize(publicFile(icon.src)).join('x')).toBe(icon.sizes);
    }
  });
});

describe('the icons (public/icons, rendered by scripts/render-icons.ts)', () => {
  it('draws the mark itself, so it looks the same without the font', () => {
    const svg = readFileSync(publicFile('/icons/icon.svg'), 'utf8');
    expect(svg).not.toMatch(/<text|font-family|@font-face|href=/);
    // The diamond goes at small sizes (handoff §9: "Drop the diamond below 32px").
    expect(svg).toMatch(/@media \(max-width: 32px\)/);
  });

  it('has an opaque 180 px Home Screen icon (iOS fills transparency with black) and a 32 px favicon', () => {
    expect(pngSize(publicFile('/icons/apple-touch-icon.png'))).toEqual([180, 180]);
    expect(pngHasAlpha(publicFile('/icons/apple-touch-icon.png'))).toBe(false);
    expect(pngHasAlpha(publicFile('/icons/maskable-512.png'))).toBe(false);
    expect(pngSize(publicFile('/icons/favicon-32.png'))).toEqual([32, 32]);
  });
});

describe('index.html', () => {
  const html = readFileSync(file('index.html'), 'utf8');

  it('links the manifest, the icons, and asks for the Home Screen app to open full screen', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<meta name="theme-color" content="#16707f" />');
    expect(html).toContain('<link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="${BRAND.name}" />`);
    for (const path of html.matchAll(/href="(\/[^"]+)"/g)) expect(existsSync(publicFile(path[1]!)), path[1]).toBe(true);
  });
});
