import { defineConfig, type Options } from 'tsup';

/** One ESM file, dist/index.js, with everything it imports inside (spec §7). test/build.test.ts reuses these options. */
export const buildOptions = {
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // Our own protocol package isn't on npm, so it goes inside the bundle (zod with it).
  noExternal: ['@nitpilot/protocol'],
} satisfies Options;

export default defineConfig(buildOptions);
