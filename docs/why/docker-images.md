# Docker images (one box that holds the whole server)

**In one sentence:** the Docker image is the server and the built web app packed into one sealed box that runs the same on any machine, and `scripts/image-smoke.sh` proves, on every pull request, that the box starts, serves, stops politely and starts again.

## Image vs container

An **image** is the finished, frozen thing: files and instructions, nothing running. A **container** is one running copy of it.

React comparison: the image is the `dist/` folder that `vite build` makes; a container is `vite preview` serving that folder. You build the folder once and can serve it as many times as you like.

## Layers, and why `package.json` goes first

A `Dockerfile` is a list of steps, and every step becomes a **layer**. Docker keeps each layer and reuses it when the step and everything before it are unchanged.

So the `Dockerfile` copies only the `package.json` files first and runs `npm ci`, and only then copies the source. Editing a source file changes the later layers but not the `npm ci` one, so the slow install is skipped. It is the same idea as a CI cache keyed on your lockfile: the install reruns only when the dependencies change.

## Four stages

The `Dockerfile` builds in stages, and only the last one ships:

1. **deps**: every dependency, dev ones included (the build needs them).
2. **build**: generates the Prisma client and builds the web app into `apps/web/dist`.
3. **prod-deps**: a second, separate install with only the runtime dependencies.
4. **runtime**: the final image. It takes `node_modules` from prod-deps and the built files from build, and nothing else.

So the shipped image has no dev dependencies, no test tools, no compilers, and no `.env`. The `.dockerignore` file lists what `docker build` must never see (`.env` files first, then `node_modules`, `.git`, `docs`), so a secret can't end up inside an image by accident, and an image can be pushed to a public registry without leaking anything.

## Why it runs as `node`, not root

By default a container's process is root inside the box. If someone found a bug in the server and got code running, root would hand them much more than they need. The `node` image ships an ordinary user called `node`; the `Dockerfile` gives it the files (`--chown=node:node`) and switches to it (`USER node`). The smoke script's manual check prints `uid=1000(node)`.

## Migrations at start

The container's command first runs `prisma migrate deploy` and then starts the server. That applies any database change (migration) the new version needs before it serves anything, like running a schema upgrade on page load before rendering.

Running it again is safe. Prisma records each migration it applied in the database, and a second run says "No pending migrations to apply" and does nothing. So restarting a container, or starting a new version on the old database, just works. The smoke test checks that message on its second start.

## Stopping politely: `--init`, `exec` and SIGTERM

`docker stop` sends the container a **signal** called SIGTERM, which means "please finish and exit". The server listens for it: `shutdown()` in `apps/server/src/main.ts` closes each connected CLI's socket with code 1012 ("server restarting", so the CLI reconnects on its own) and then exits with code 0.

The signal only helps if it reaches node. Two things make sure it does:

- **`exec`.** The command runs through a shell (`sh -c "prisma migrate deploy && node ..."`). Without `exec` the shell stays in between: it gets the signal, and node never does. With `exec` the shell replaces itself with node. The smoke test proved it: with `exec` removed, the container exited with 143 (128 + 15, "died of SIGTERM") instead of 0, and the CLI never heard 1012.
- **`--init`** (compose: `init: true`). The first process in a container has special duties (passing signals on, cleaning up dead child processes) that node doesn't do. `--init` puts a tiny program in front that does them.

## The health check

The `HEALTHCHECK` line asks Docker to call `/healthz` every 30 seconds, from inside the container. The slim image has no `curl`, so it uses node's own `fetch`. `docker ps` then shows `(healthy)` or `(unhealthy)` next to the container, and compose can wait for it.

## What `image:smoke` checks

`npm run image:smoke` builds the image and runs it next to a throwaway Postgres, then checks that: `/healthz` answers; Docker reports it healthy; `GET /` returns the web app; the server uses under 384 MiB of memory while idle; `docker stop` ends with exit code 0 in under 10 seconds; a connected CLI socket is closed with 1012; and the same container starts again with its migrations already applied. It removes everything it made, pass or fail. CI runs it on every pull request (the `image` job in `.github/workflows/ci.yml`), so a change that breaks the image fails before it merges.

## Where

`Dockerfile`, `.dockerignore` and `scripts/image-smoke.sh` at the repository root. The shutdown code is `shutdown()` in `apps/server/src/main.ts`; the CI job is `image` in `.github/workflows/ci.yml`.
