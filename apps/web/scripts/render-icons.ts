/**
 * Makes the app's PNG icons from public/icons/icon.svg, by drawing it in Playwright's Chromium (the browser the
 * Playwright tests already install) and saving a screenshot of each size. Run it by hand after changing the SVG, and
 * commit the PNGs it writes: `npm run icons -w apps/web`.
 *
 * The SVG is the one source. Each PNG is it, as an image of that size, after one of these small changes:
 * - `rounded`: as it is, the rounded square on a transparent background (the manifest's "any" icons, the favicon).
 * - `full-bleed`: square corners, no transparency. iOS rounds a Home Screen icon itself and turns transparent
 *   corners black.
 * - `maskable`: full bleed too, with the mark shrunk to 80% so it stays inside the safe zone (the centre circle, 80%
 *   across) whatever shape Android cuts the icon to.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ICONS = fileURLToPath(new URL('../public/icons/', import.meta.url));

type Variant = 'rounded' | 'full-bleed' | 'maskable';

const OUTPUTS: { file: string; size: number; variant: Variant }[] = [
  { file: 'icon-192.png', size: 192, variant: 'rounded' },
  { file: 'icon-512.png', size: 512, variant: 'rounded' },
  { file: 'maskable-512.png', size: 512, variant: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, variant: 'full-bleed' },
  // The browser tab. The SVG's media query drops the diamond at this size (handoff: "Drop the diamond below 32px"):
  // a tab draws this file at 16 CSS px (32 device px on a Retina screen), the "below 32px" case the handoff means.
  { file: 'favicon-32.png', size: 32, variant: 'rounded' },
];

/** Replace `find` in the SVG, and fail loudly if it isn't there (the SVG changed shape): never a silent wrong icon. */
function edit(svg: string, find: string, replace: string): string {
  if (!svg.includes(find)) throw new Error(`icon.svg has no ${find}: update scripts/render-icons.ts to match it`);
  return svg.replace(find, replace);
}

function variantOf(svg: string, variant: Variant): string {
  if (variant === 'rounded') return svg;
  const square = edit(svg, 'rx="118"', 'rx="0"');
  if (variant === 'full-bleed') return square;
  return edit(square, '<g class="glyph">', '<g class="glyph" transform="translate(256 256) scale(0.8) translate(-256 -256)">');
}

const source = readFileSync(`${ICONS}icon.svg`, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, variant } of OUTPUTS) {
    const svg = variantOf(source, variant);
    // As an <img>, so the SVG's own media queries see the image's size, as they will in a browser tab.
    const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block"></body>`);
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    // A transparent background only where the icon may have one.
    const png = await page.locator('img').screenshot({ omitBackground: variant === 'rounded' });
    writeFileSync(`${ICONS}${file}`, png);
    console.log(`wrote public/icons/${file} (${size}×${size}, ${variant})`);
  }
} finally {
  await browser.close();
}
