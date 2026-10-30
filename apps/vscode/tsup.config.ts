import { defineConfig } from 'tsup';

/** One CommonJS file, dist/extension.cjs: the format every VS Code fork loads. `vscode` is provided by the editor. */
export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  clean: true,
  external: ['vscode'],
  // The CLI's config and server client, our protocol package and zod all go inside the bundle (spec: "Where it lives").
  noExternal: ['nitpilot', '@nitpilot/protocol', 'zod'],
});
