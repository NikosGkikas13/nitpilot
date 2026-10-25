// Tests for check-release-version.mjs, run by the root `npm test` with Node's own test runner (no Vitest needed).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkReleaseTag } from './check-release-version.mjs';

/** A folder laid out like the repo, with the CLI at these two versions. */
function repoWith(packageVersion, cliVersion = packageVersion) {
  const root = mkdtempSync(path.join(tmpdir(), 'release-version-'));
  mkdirSync(path.join(root, 'apps/cli/src'), { recursive: true });
  writeFileSync(path.join(root, 'apps/cli/package.json'), JSON.stringify({ name: 'nitpilot', version: packageVersion }));
  writeFileSync(path.join(root, 'apps/cli/src/version.ts'), `export const CLI_VERSION = '${cliVersion}';\n`);
  return root;
}

test('v0.1.0 is a release', () => {
  assert.deepEqual(checkReleaseTag('v0.1.0', repoWith('0.1.0')), { ok: true, kind: 'release', version: '0.1.0' });
});

test('v0.1.0-rc.1 is a release candidate', () => {
  assert.deepEqual(checkReleaseTag('v0.1.0-rc.1', repoWith('0.1.0')), { ok: true, kind: 'rc', version: '0.1.0-rc.1' });
});

test('a tag ahead of package.json is refused, naming both', () => {
  assert.deepEqual(checkReleaseTag('v0.2.0', repoWith('0.1.0')), {
    ok: false,
    message: 'tag v0.2.0 but apps/cli/package.json says 0.1.0',
  });
});

test('a CLI_VERSION that disagrees is refused', () => {
  assert.deepEqual(checkReleaseTag('v0.1.0', repoWith('0.1.0', '0.0.9')), {
    ok: false,
    message: 'tag v0.1.0 but CLI_VERSION in apps/cli/src/version.ts says 0.0.9',
  });
});

test('a tag without the v is refused', () => {
  const result = checkReleaseTag('0.1.0', repoWith('0.1.0'));
  assert.equal(result.ok, false);
  assert.match(result.message, /^tag 0\.1\.0 is not v<X\.Y\.Z> or v<X\.Y\.Z>-rc\.<N>/);
});

test('other pre-release names are refused', () => {
  assert.equal(checkReleaseTag('v0.1.0-beta.1', repoWith('0.1.0')).ok, false);
  assert.equal(checkReleaseTag('v0.1', repoWith('0.1.0')).ok, false);
});
