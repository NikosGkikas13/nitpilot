import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // docs/ holds reference material (the design handoff prototypes), not our code.
  { ignores: ['**/node_modules/**', '**/dist/**', 'apps/server/src/generated/**', 'docs/**', '.superpowers/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The web app runs in the browser, and its components follow React's rules of hooks.
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    // The service worker is plain JavaScript that runs in the browser's worker, where `self` is the worker.
    files: ['apps/web/public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // Run by hand with Node (npm run icons -w apps/web), not in the browser.
    files: ['apps/web/scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The engine is a pure function: same input, same output, no I/O.
    // See docs/why/pure-engine.md.
    // Engine files import each other as './x'; anything reached through '../' is outside the engine.
    files: ['apps/server/src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./(lib/prisma|generated)(/|$)|^@prisma/|^pg$',
              message: 'The engine is pure: no database access.',
            },
            {
              regex: '^\\.\\./(platform|http|chats|tasks|ingest|auth|ws|jobs)(/|$)|^(hono|ws)(/|$)',
              message: 'The engine is pure: no platform, HTTP or WebSocket code.',
            },
            {
              regex: '^(node:)?(fs|net|http|https|child_process)(/|$)',
              message: 'The engine is pure: no I/O.',
            },
          ],
        },
      ],
    },
  },
);
