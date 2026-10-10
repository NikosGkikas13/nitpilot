import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'tsup';
import { describe, expect, it } from 'vitest';
import { buildOptions } from '../tsup.config';
import { tempDir } from './temp';

const run = promisify(execFile);
const cliDir = fileURLToPath(new URL('..', import.meta.url));

describe('the published bundle', () => {
  it('is one file that runs on its own, without the workspace packages', async () => {
    // Built into a folder outside the repo: from there Node can't find node_modules/@nitpilot/protocol.
    const outDir = tempDir();
    await build({ ...buildOptions, entry: [join(cliDir, 'src/index.ts')], outDir, config: false, silent: true });
    const { stdout } = await run(process.execPath, [join(outDir, 'index.js'), '--help'], { cwd: outDir });
    expect(stdout).toContain('Usage: nitpilot <command>');
    // No test data in the product: this fails if CLI code ever uses @nitpilot/protocol/test-samples.
    // (M8 itself, the samples leaving the main entry, is guarded by packages/protocol/src/index.test.ts.)
    expect(readFileSync(join(outDir, 'index.js'), 'utf8')).not.toContain('Found a crash on empty input');
  }, 60_000);
});
