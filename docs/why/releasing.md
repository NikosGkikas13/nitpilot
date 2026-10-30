# Releasing (a tag in, an image and a package out)

**In one sentence:** pushing a git tag like `v0.1.0` makes GitHub's own machines build the Docker image, put it on GitHub's image registry and publish the CLI to npm, with nobody's laptop or password involved (`.github/workflows/release.yml`, `scripts/check-release-version.mjs`; the how-to is `docs/releasing.md`).

## A tag is a name for a commit

A branch moves every time you commit. A **tag** is a label stuck on one commit that never moves: `v0.1.0` means "exactly this code". React comparison: a branch is `main` in your editor, always the latest; a tag is the version number you'd see in a library's `package.json` after you `npm install` it, pointing at one frozen snapshot. Pushing a tag is the "go" button: the release workflow starts on `push: tags: ['v*']`.

## A registry is npm for images

npm stores packages and hands them out by name and version. A **container registry** does the same for Docker images. Nitpilot's goes on GitHub's registry, GHCR, as `ghcr.io/nikosgkikas13/nitpilot:<version>`. The part after the colon is the image's **tag** (a second meaning of the word, sorry: a git tag marks a commit; an image tag marks an image).

- `:0.1.0` is that exact release. It should never change; treat it as final (a re-run of the image job would re-push it, maybe with a new digest).
- `:latest` is "whatever the newest real release is". It moves with each release, like the `latest` dist-tag on npm. People who run `docker pull ...:latest` get the newest one.
- `:0.1.0-rc.1` is a **release candidate**: "this should be 0.1.0, let's try it before we say so". An `-rc` tag never moves `:latest` and never publishes to npm, so you can test a real image on the server without anyone else getting it by accident. Pre-releases work the same way in npm: `^0.9.0` does not match `0.9.1-rc.1`, because pre-releases are skipped unless someone asks for them.

The Dockerfile's `org.opencontainers.image.source` label is what links the image to this repo on GitHub, so it shows up under the repo's Packages.

## Trusted publishing: no npm password anywhere

The old way to publish from CI was to create an npm access token and paste it into GitHub's secrets. That token can publish from anywhere, forever, until someone notices it leaked.

**Trusted publishing** replaces it with an introduction. On npmjs.com you tell npm: "trust the workflow file `release.yml` in the repo `NikosGkikas13/nitpilot`". Then, on each run, GitHub signs a short-lived identity token (an **OIDC** token, which is just a signed note saying "this is run #123 of release.yml in NikosGkikas13/nitpilot") and npm checks the signature and the names. React comparison: it's like a Vercel deploy hook that works only from one repo and one branch, instead of an API key you carry around.

Why the workflow says `id-token: write`: by default GitHub does not hand a job the right to ask for that signed note. The `npm` job asks for it, and only that job; the other jobs get `contents: read` or `packages: write` and nothing else. (`permissions: {}` at the top of the file turns everything off first.) npm wants a new connection used within two days of making it, or it throws the connection away; that is why Nitpilot sets it up on release day, right before pushing the tag, and not weeks ahead. Trusted publishing also needs npm 11.5.1 or newer, which is why the job upgrades npm before publishing.

## What the provenance badge proves

`npm publish --provenance` attaches a signed statement to the published version: "this tarball was built from commit `abc123` of `NikosGkikas13/nitpilot`, by this workflow run". npmjs.com shows it as a "Built and signed on GitHub Actions" badge with a link to that run and that commit. It proves the package came from the public source and not from somebody's laptop, so anyone can read the code that was released. It does not prove the code is good; it proves where it came from. For it to work, `repository.url` in `apps/cli/package.json` has to name this repo.

## Why the tag is checked against two version strings

The CLI's version is written in two places: `version` in `apps/cli/package.json` (what npm publishes) and `CLI_VERSION` in `apps/cli/src/version.ts` (what the CLI reports about itself, for example in `nitpilot --version`). Forget one and you ship a CLI that says one thing and is labelled another. So the first job runs `scripts/check-release-version.mjs`, which refuses the tag unless it is `vX.Y.Z` or `vX.Y.Z-rc.N` and `X.Y.Z` matches both files. The check is a tiny pure function with its own tests (`scripts/check-release-version.test.mjs`), and it runs before anything is pushed, because a version on npm can never be published twice or taken back.

## Why the VS Code extension has its own version

The CLI and the server release together because they talk to each other: a new message in the protocol needs both. The extension only reads `/api/me` and `/api/me/chats`, which change rarely, and it changes rarely itself. Sharing `vX.Y.Z` would push an identical extension to two stores with every server fix, and every store version is permanent. So it gets its own number and its own tag, `vscode-vX.Y.Z`, and its own workflow (`release-vscode.yml`), which `v*` tags don't trigger. The Marketplace and Open VSX both offer the same trusted publishing as npm: they check a token GitHub signs for that one workflow run, so there's no store password in the repo's secrets.
