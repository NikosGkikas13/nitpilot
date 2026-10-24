# Releasing Nitpilot

A release is a git tag. The workflow in `.github/workflows/release.yml` does the rest. Why it works this way: `docs/why/releasing.md`.

## What a tag does

| Tag | Check the tag | Image to GHCR | CLI to npm |
|---|---|---|---|
| `vX.Y.Z-rc.N` (for example `v0.1.0-rc.1`) | runs | `ghcr.io/nikosgkikas13/nitpilot:X.Y.Z-rc.N` only | skipped |
| `vX.Y.Z` (for example `v0.1.0`) | runs | `:X.Y.Z` and `:latest` | published, with provenance |

Anything else (`0.1.0`, `v0.1`, `v0.1.0-beta.1`) is refused by the first job and nothing is pushed.

## How to release

1. Choose the version. Set it in **both** places, to the same value (the `-rc.N` part is never written in the files, only in the tag):
   - `version` in `apps/cli/package.json`
   - `CLI_VERSION` in `apps/cli/src/version.ts`
2. Commit that change and let CI go green.
3. Tag the commit and push the tag (from the repo folder):
   ```bash
   git tag v0.1.0-rc.1        # or v0.1.0
   git push origin v0.1.0-rc.1
   ```
4. Watch https://github.com/NikosGkikas13/nitpilot/actions: the **Release** run has three jobs.
   - **Check the tag** runs `node scripts/check-release-version.mjs <tag>` and passes `kind` (`rc` or `release`) and `version` to the others. A red job here means the tag and the files disagree; the message names both.
   - **Image to GHCR** builds the Dockerfile and pushes the tags in the table. Look at its log for the pushed tags and digest. The package appears under the repo's Packages.
   - **CLI to npm** (releases only, after the image) builds `apps/cli` and runs `npm publish --provenance`. Check https://www.npmjs.com/package/nitpilot for the new version and its provenance badge.

You can try the package contents any time without publishing: `npm run build -w apps/cli && npm publish -w apps/cli --dry-run`. CI does exactly this on every push.

## If a job fails

- Open the failed run, then **Re-run failed jobs**. Only the failed job and the ones after it run again. A transient failure (a registry hiccup) is fixed this way.
- If the **tag check** failed, the tag is wrong or the files are. Fix the files in a new commit, delete the bad tag (`git tag -d v0.1.0` and `git push origin :refs/tags/v0.1.0`), and tag the new commit. Re-running would build the old commit.
- If **npm** failed after the image succeeded, re-run just that job. The image is already pushed and re-pushing the same tag is harmless.

## One-way doors

- **A version on npm can never be published twice**, even after deleting it. A mistake means a new version number (`0.1.1`). That is why release candidates exist: put the real thing through `-rc` first.
- `:latest` on GHCR moves with every release tag, and a pushed image tag can be overwritten, but treat released tags (`:0.1.0`) as final.
- Trusted publishing is set once on npmjs.com (package Settings, Trusted Publisher: repository `NikosGkikas13/nitpilot`, workflow `release.yml`). If the workflow file is renamed, update it there too.
