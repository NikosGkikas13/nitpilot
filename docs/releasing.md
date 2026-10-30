# Releasing Nitpilot

A release is a git tag. The workflow in `.github/workflows/release.yml` does the rest. Why it works this way: `docs/why/releasing.md`.

## What a tag does

| Tag | Check the tag | Image to GHCR | CLI to npm |
|---|---|---|---|
| `vX.Y.Z-rc.N` (for example `v0.1.0-rc.1`) | runs | `ghcr.io/nikosgkikas13/nitpilot:X.Y.Z-rc.N` only | skipped |
| `vX.Y.Z` (for example `v0.1.0`) | runs | `:X.Y.Z` and `:latest` | published, with provenance |

Anything else (`0.1.0`, `v0.1`, `v0.1.0-beta.1`) is refused by the first job and nothing is pushed.

## How to release

1. Choose the version. Set it in **all three** places, to the same value (the `-rc.N` part is never written in the files, only in the tag):
   - `version` in `apps/cli/package.json`
   - `CLI_VERSION` in `apps/cli/src/version.ts`
   - `SERVER_VERSION` in `apps/server/src/version.ts` (what `/healthz` and `nitpilot doctor` report)
2. Commit that change, then open a PR (or push to `main`) and let CI go green before tagging.
3. Tag the commit and push the tag (from the repo folder):
   ```bash
   git tag v0.1.0-rc.1        # or v0.1.0
   git push origin v0.1.0-rc.1
   ```
4. Watch https://github.com/NikosGkikas13/nitpilot/actions: the **Release** run has three jobs.
   - **Check the tag** runs `node scripts/check-release-version.mjs <tag>` and passes `kind` (`rc` or `release`) and `version` to the others. A red job here means the tag and the files disagree; the message names both.
   - **Image to GHCR** builds the Dockerfile for `linux/amd64` and `linux/arm64` and pushes the tags in the table (each tag holds both). The arm64 half is emulated, so this job takes the longest (well over ten minutes without cache). Look at its log for the pushed tags and digest. The package appears under the repo's Packages.
   - **CLI to npm** (releases only, after the image) builds `apps/cli` and runs `npm publish --provenance`. Check https://www.npmjs.com/package/nitpilot for the new version and its provenance badge.

You can try the package contents any time without publishing: `npm run build -w apps/cli && npm publish -w apps/cli --dry-run`. CI does exactly this on every PR and every push to `main`.

## If a job fails

- Open the failed run, then **Re-run failed jobs**. Only the failed job and the ones after it run again. A transient failure (a registry hiccup) is fixed this way.
- If the **tag check** failed, the tag is wrong or the files are. Fix the files in a new commit, delete the bad tag (`git tag -d v0.1.0` and `git push origin :refs/tags/v0.1.0`), and tag the new commit. Re-running would build the old commit.
- If **npm** failed after the image succeeded, re-run just that job. The image is already pushed and re-pushing the same tag is harmless.

## One-way doors

- **A version on npm can never be published twice**, even after deleting it. A mistake means a new version number (`0.1.1`). That is why release candidates exist: put the real thing through `-rc` first.
- `:latest` on GHCR moves with every release tag, and a pushed image tag can be overwritten, but treat released tags (`:0.1.0`) as final.
- Trusted publishing is set up on npmjs.com on release day (package Settings, Trusted Publisher, GitHub Actions: organization `NikosGkikas13`, repository `nitpilot`, workflow `release.yml`, environment left empty, permission `npm publish`). npm expects a publish through it within 48 hours, or the connection expires; its fields can't be edited, so delete it and make it again. If the workflow file is renamed, redo it. If npm's staged publishing holds the version for approval, approve it with 2FA (the package's Staged Packages tab, or `npm stage approve <stage-id>`).

## Releasing the VS Code extension

The extension (`apps/vscode`) has its own version and its own tag, `vscode-vX.Y.Z`, released by `.github/workflows/release-vscode.yml`. A `v*` tag never publishes it, and a `vscode-v*` tag never touches npm or GHCR. Why: `docs/why/releasing.md`.

1. Set the version in `apps/vscode/package.json` (the only place it's written). Add a section to `apps/vscode/CHANGELOG.md` (the Marketplace shows it) and an entry to the docs changelog page (`apps/web/src/routes/Docs/pages/changelog.md`).
2. Try the package first: `npm run package -w apps/vscode`, then in VS Code **Extensions: Install from VSIX…** and pick `apps/vscode/dist/nitpilot.vsix`. CI also packages it on every push.
3. Commit, push to `main`, let CI go green, then tag and push the tag:
   ```bash
   git tag vscode-v0.1.0
   git push origin vscode-v0.1.0
   ```
4. Watch the **Release VS Code extension** run on GitHub Actions. One job: check the tag against `package.json`, package the `.vsix` once, publish that same file to the Marketplace (`vsce publish --oidc`) and Open VSX (`ovsx publish`), then attach it to a GitHub release (a re-run finds the release already made and fails there; that's harmless, the stores are done). The Marketplace can take a few minutes to verify a new version before it shows.

If a step fails, open the run and **Re-run failed jobs**. Both publish steps use `--skip-duplicate`, so a store that already has this version is skipped, not an error. A wrong tag: fix the file, delete the tag (`git tag -d vscode-v0.1.0` and `git push origin :refs/tags/vscode-v0.1.0`), tag again.

**One-way door:** neither store lets you publish the same version twice, even after unpublishing. A mistake means a new patch version.

### One-time setup

Both stores trust this workflow file the way npm does (trusted publishing), so there are no long-lived tokens, except one for Open VSX's very first upload.

- **Visual Studio Marketplace:** a publisher with ID `nitpilot` (https://marketplace.visualstudio.com/manage, **Create publisher**). Then in that publisher, **Trusted Publishing** → **Create**: owner `NikosGkikas13`, repository `nitpilot`, workflow `release-vscode.yml`, no environment.
- **Open VSX:** an Eclipse account linked to your open-vsx.org profile, the Publisher Agreement signed, the namespace `nitpilot` created and claimed as owner (trusted publishing needs an owner, not a contributor). Open VSX trusts a workflow only once the extension exists there, so the first release uses an access token stored as the repo secret `OVSX_PAT`. After that release: in open-vsx.org **Settings → Trusted Publishers** add namespace `nitpilot`, GitHub Actions, owner `NikosGkikas13`, repository `nitpilot`, workflow `release-vscode.yml`; then delete the `OVSX_PAT` secret and the token. With no secret, `ovsx` exchanges the run's token on its own.
