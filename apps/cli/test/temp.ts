import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/** A fresh empty folder outside the repo, deleted when the test ends. Call it inside a test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nitpilot-test-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
