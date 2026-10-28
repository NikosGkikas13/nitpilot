#!/usr/bin/env node
// The release workflow's first step (docs/releasing.md): is this git tag a version we can release, and does it match
// the version in all three places it's written (the CLI's two, the server's one)? Prints `rc` or `release` and exits 0;
// otherwise names the mismatch and exits 1, so nothing gets pushed under a wrong version.
//
//   node scripts/check-release-version.mjs v0.1.0-rc.1
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = /^v(\d+\.\d+\.\d+)(-rc\.\d+)?$/;

/**
 * Check `tag` against the CLI's version in `repoRoot`.
 * @returns {{ ok: true, kind: 'rc' | 'release', version: string } | { ok: false, message: string }}
 */
export function checkReleaseTag(tag, repoRoot) {
  const match = TAG.exec(tag);
  if (!match) return { ok: false, message: `tag ${tag} is not v<X.Y.Z> or v<X.Y.Z>-rc.<N>` };
  const [, base, rc] = match;

  const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, 'apps/cli/package.json'), 'utf8')).version;
  if (packageVersion !== base) return { ok: false, message: `tag ${tag} but apps/cli/package.json says ${packageVersion}` };

  const versionFile = readFileSync(path.join(repoRoot, 'apps/cli/src/version.ts'), 'utf8');
  const cliVersion = /CLI_VERSION = '([^']+)'/.exec(versionFile)?.[1];
  if (cliVersion !== base) return { ok: false, message: `tag ${tag} but CLI_VERSION in apps/cli/src/version.ts says ${cliVersion}` };

  // The server reports its own version in /healthz and to `nitpilot doctor`, so it ships with the same number.
  const serverFile = readFileSync(path.join(repoRoot, 'apps/server/src/version.ts'), 'utf8');
  const serverVersion = /SERVER_VERSION = '([^']+)'/.exec(serverFile)?.[1];
  if (serverVersion !== base) {
    return { ok: false, message: `tag ${tag} but SERVER_VERSION in apps/server/src/version.ts says ${serverVersion}` };
  }

  return { ok: true, kind: rc ? 'rc' : 'release', version: tag.slice(1) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = checkReleaseTag(process.argv[2] ?? '', repoRoot);
  if (!result.ok) {
    console.error(`check-release-version: ${result.message}`);
    process.exit(1);
  }
  console.log(result.kind);
}
