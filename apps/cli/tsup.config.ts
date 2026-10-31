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
  // Bundled CommonJS packages (yaml, for .nitpilot.yml) call require() for Node's built-ins; an ESM file has no require of its own.
  banner: { js: "import { createRequire as __nitpilotCreateRequire } from 'node:module'; const require = __nitpilotCreateRequire(import.meta.url);" },
} satisfies Options;

export default defineConfig(buildOptions);
