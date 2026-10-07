import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// engine → src → server → apps → repo root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

async function ruleIdsFor(code: string): Promise<(string | null)[]> {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, 'apps/server/src/engine/example.ts') });
  return result!.messages.map((m) => m.ruleId);
}

describe('engine purity rule', { timeout: 30_000 }, () => {
  it.each([
    "import { prisma } from '../lib/prisma';\nexport const x = prisma;\n",
    "import { Hono } from 'hono';\nexport const x = Hono;\n",
    "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n",
    "import { dispatch } from '../chats/dispatch';\nexport const x = dispatch;\n",
  ])('blocks %s', async (code) => {
    expect(await ruleIdsFor(code)).toContain('no-restricted-imports');
  });

  it('allows the protocol package', async () => {
    expect(await ruleIdsFor("import { DEFAULT_RULES } from '@nitpilot/protocol';\nexport const x = DEFAULT_RULES;\n")).toEqual([]);
  });
});
