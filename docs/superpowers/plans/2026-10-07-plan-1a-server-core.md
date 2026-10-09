# Plan 1a: Server Core (M0–M5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Nitpilot server core (workspace, protocol, pure engine, server foundations, webhook ingress and the outbox), so GitHub webhooks become chats, points, queued jobs and GitHub writes. There is no CLI and no UI yet.

**Architecture:** npm workspaces with `packages/protocol` (zod schemas and the `BRAND` constant) and `apps/server` (Hono + Prisma 7 on Postgres, one Node process). Every workflow rule lives in one pure function, `decide()`, which works like a Redux reducer: (state, event) → (new state, timeline items, commands). A dispatcher loads a chat, calls `decide`, and writes the new state, timeline, jobs and outbox tasks in one database transaction. GitHub is only ever called from outbox tasks, which a 1-second ticker runs.

**Tech Stack:** Node 22, TypeScript 5 (ESM), npm workspaces, zod 4, Hono 4 + `@hono/node-server` + `hono/jsx`, Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), PostgreSQL 16, `pg`, `yaml`, Vitest 4, ESLint 9 + typescript-eslint, `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-07-nitpilot-design.md`. Read §5–§15, §17, §19 and §20 before starting, and re-read the section a task names before doing that task. `CLAUDE.md` explains who the developer is and how backend code must read.

**Next:** Plan 1b (`docs/superpowers/plans/2026-10-07-plan-1b-cli-and-agents.md`) builds the CLI hub, the CLI and the agents on top of this.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the spec.

- One Node process plus Postgres. No Redis, no worker process, no external queue (§5, §7).
- Every name-bearing string (CLI name, config file, comment marker, token prefix, ref namespace) comes from `BRAND` in `packages/protocol` (spec header).
- Every platform id is stored as a **string** (§8).
- Prisma: `cuid()` ids for our own rows, `createdAt`/`updatedAt` on every model, cascading deletes (§8).
- `apps/server/src/engine/**` must not import database, platform, HTTP or WebSocket code. ESLint `no-restricted-imports` enforces this (§9).
- GitHub calls happen only inside Tasks (the outbox), never while a chat's lock is held (§9).
- Webhooks: HMAC (`X-Hub-Signature-256`) checked on the raw body, timing-safe, body ≤ 1 MB, reply 202 well within 10 s, dedupe on `X-GitHub-Delivery` (§14.7, §15).
- `RawEvent` rows are purged after 14 days. Rows still `received` are replayed on boot (§8).
- CLI tokens use the `nit_` prefix, and only their sha256 hash is stored (§8).
- The CLI login code expires after 10 minutes (§8).
- Secrets at rest use AES-256-GCM (§14.7).
- Retries: up to 3 attempts, and quota errors don't count as attempts (§9.4).
- Summary ≤ 60,000 characters, with long logs ending in "+N more in chat". Each point ≤ 4,000 characters, each review ≤ 20 points (§15).
- Team-rule defaults: `max_rounds` 3 (allowed 1–10), `always_escalate: [security]`, `auto.review`/`auto.address` true, `ignore_paths ["**/*.lock", "dist/**"]`, `trusted_bots ["coderabbitai[bot]"]`, `debounce_seconds` 30, `max_points_per_review` 20 (§13).
- Hosted mode (`PUBLIC_REPOS_ONLY=true`) drops payloads where `repository.private` is true (§14.9).
- In Plan 1, Auto is always on for people; only the team can turn it off (§6.1).
- Local server port is 8787 (§17).

## Review Focus

These five failure modes are implied by the spec but easy to miss, and they would hurt a real user. Each one has a test in the task named here.

1. **Our own GitHub writes come back as webhooks.** The summary edit, the review we posted, our thread replies and our own push must be ignored, never treated as new activity. Without this, Nitpilot argues with itself. → Task 23 (router filter: hidden marker, `GithubWrite` ids, `expectedPushSha`).
2. **The server restarts after a GitHub write succeeded but before the task was marked done.** The retry must not post a second review or a second summary comment. → Task 26 (on a retry, look for our marker on GitHub before posting).
3. **Webhooks arrive twice or out of order.** Examples: a redelivery; review comments arriving after (or before) `pull_request_review.submitted`; `synchronize` during an address job. There must be no duplicate points or jobs. → Task 18 (delivery id), Task 9 (comment-id dedupe, review with known comments), Task 21 (a submitted review fetches its own comments), Task 23 (`SeenComment`: the same comment through two events).
4. **The PR is closed, reopened or pushed to while a timer or job is pending.** The timer becomes a no-op, the job is cancelled, and a human push during an address pass replans it. → Task 7 (close/reopen), Task 9 (late timer, push mid-address). The force-push "full re-review" fallback needs git, so it lives in Plan 1b's `list_changed_files`/`get_diff`.
5. **Awkward PR shapes:** PRs from forks, a deleted fork (`head.repo: null`), and paths with spaces or unicode. → Task 19 (`gitSpec` and snapshot for a deleted fork), Task 20 (normalizing it), Task 26 (paths passed to GitHub unchanged).

## Decisions this plan makes where the spec is silent

| Topic | Decision |
|---|---|
| Natural keys | The engine refers to participants by `githubId + role` and to points by their chat-local `number`. The DB stores `Point.raisedByGithubId`, `Message.authorGithubId` and `Message.pointNumber` instead of the spec's `raisedById`/`authorParticipantId`/`pointId`. This keeps `decide` pure (no id generation). |
| Protocol point references | Agents and results refer to points by number (P1 → `1`). |
| Job commands | Besides the spec's `enqueue_job` and `cancel_jobs`, the engine emits `complete_job`, `retry_job` and `fail_job`. Every job change is a command, so it's visible in table tests. |
| `job_failed` | Carries `{jobId, reason, retryable}`. The **engine** decides whether that is final (3 attempts; quota, cap and branch moves don't count), so the rule is table-tested. |
| Drafts | When the team turns Auto off, the job is queued with `applyState = 'draft'`. Its result is stored but not applied, and the person gets `attention = 'drafts'`. Publishing drafts is Plan 2. |
| Loose comments vs reviews | A submitted review whose state is `commented` with an empty body (GitHub's "Add single comment") is loose and debounced. `changes_requested`, `approved`, or a non-empty body is handled at once. |
| Trusted bots | The adapter computes trust from `author_association`. The router adds `trusted_bots` from the repo's rules. |
| Deleted forks | `PrSnapshot.headRepoFullName` and `gitSpec().headRepoPath` are `string \| null`. `null` means the fork is gone and nothing can be pushed. |
| Platform adapter shape | Spec §12.1's interface is split into `PlatformReads` (Tasks 19–21) and `PlatformWrites` (Task 26), so the server can be wired up step by step. Writes take an optional `{ reuseIfContains }` so a retry finds an earlier write instead of duplicating it. |
| Deferred adapter methods | `findOpenPrsFor` and `listThreads` arrive in Plan 1b with CLI catch-up. `verifyWebhook`/`deliveryId` return with a second platform; the `/webhooks/github` route checks GitHub's HMAC itself. |
| Comments seen twice | A comment can arrive on its own and again inside its submitted review. A small `SeenComment` table (purged after 14 days, like `RawEvent`) makes sure it is handled once. |
| One active job per participant | `Job.activeFor` holds the participant id while the job is queued or running, null after. Its `@unique` constraint enforces the rule without a raw-SQL index that Prisma would try to drop. |
| Webhook fixtures | Typed builder functions in `apps/server/test/fixtures/github.ts`, shaped like GitHub's documented payloads. Plan 1b's live acceptance (M13) checks them against real deliveries. |
| Test DB | DB tests are named `*.db.test.ts` and run one file at a time. They use unique data; the few tests of global sweeps call `resetDb()` first. |
| Rules warning | An invalid `.nitpilot.yml` is stored in `Repo.rulesError` and defaults apply. The transcript page (Plan 1b) and the web app (Plan 2) display it. |

## How to work in this repo

- Start Postgres once: `docker compose up -d postgres` (it listens on **5433** so it doesn't collide with Odyhook's 5432).
- Copy `apps/server/.env.example` to `apps/server/.env` (Task 13 explains each value).
- Run everything: `npm test`. Only the pure tests: `npm run test:unit -w apps/server`. Only the DB tests: `npm run test:db -w apps/server`.
- Type-check: `npm run typecheck`. Lint: `npm run lint`.
- Imports have no file extensions (TypeScript `moduleResolution: "Bundler"`; `tsx` and Vitest resolve them).
- When a task introduces a backend concept, it also writes the explainer in `docs/why/` named in the task (CLAUDE.md). Keep each one short and plain, written for a React developer, and point to the file that uses the concept.
- Commit after every task, with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map (what exists at the end of Plan 1a)

```
package.json · tsconfig.base.json · eslint.config.mjs · docker-compose.yml · .github/workflows/ci.yml
packages/protocol/src/
  brand.ts                 BRAND constant
  enums.ts                 every enum as a zod schema + type
  rules.ts                 TeamRulesSchema, DEFAULT_RULES
  job-bundle.ts            JobBundle (server → CLI)
  job-result.ts            JobResult (CLI → server), Snippet
  envelope.ts              wire envelope, PROTOCOL_VERSION, PING_SEC, LEASE_SEC
  cli-messages.ts          CLI ↔ server message unions
  close-codes.ts           WebSocket close codes
  api.ts                   REST DTOs for CLI login, /api/me
  test-samples.ts          sample values for tests in every workspace
  index.ts                 re-exports
apps/server/
  prisma/schema.prisma · prisma/migrations/ · prisma.config.ts · .env.example
  scripts/dev-tunnel.ts    cloudflared quick tunnel + webhook URL update
  src/
    main.ts                boot: env, singleton lock, wiring, recovery, ticker, HTTP
    version.ts
    engine/                types, context, state, rules, jobs, points, advance, lifecycle,
                           external, results, decide, summary, test-builders   (pure)
    lib/                   env, prisma, crypto, tokens, hmac, csrf, advisory-lock, key-lock,
                           serial-queue, markers, sanitize, urls
    http/                  app.ts, errors.ts, pages/ (layout, home, approve),
                           routes/ (auth, cli, cli-approve, webhooks, setup)
    auth/                  github-oauth, users, session, user-tokens, cli-login, cli-token
    platform/              types.ts
      github/              client, app-auth, payloads, mapping, reads, writes, platform,
                           normalize/ (pull-request, comments, installation, index)
      fake/                fake-platform.ts (GitHub in memory, for tests)
    ingest/                record, process, handle, installations, recovery
    chats/                 load, save, apply-commands, dispatch, rules, people, refs, route-event
    tasks/                 runner, notifier, handlers/ (timer, summary, review, replies, notify, shared, index)
  test/                    db.ts, fake-fetch.ts, http.ts, app.ts, webhooks.ts, fixtures/github.ts,
                           integration/plan-1a.db.test.ts
apps/cli/                  package stub only (Plan 1b)
docs/why/                  pure-engine, one-process, oauth-pkce, webhooks, outbox-and-restarts
```

---

## Milestone M0: Skeleton

### Task 1: Workspace skeleton

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `eslint.config.mjs`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/vitest.config.ts`, `packages/protocol/src/brand.ts`, `packages/protocol/src/brand.test.ts`, `packages/protocol/src/index.ts`
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/vitest.config.ts`, `apps/server/src/version.ts`
- Create: `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/src/version.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `BRAND` (from `@nitpilot/protocol`), the workspace scripts `npm test`, `npm run typecheck` and `npm run lint`, and `SERVER_VERSION` / `CLI_VERSION`.

- [x] **Step 1: Create the root workspace files**

`package.json`:
```json
{
  "name": "nitpilot-monorepo",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint ."
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

`eslint.config.mjs` (the engine purity rule is here from day one, so the engine can never start depending on I/O):
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'apps/server/src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
```

Append to `.gitignore`:
```
node_modules/
dist/
coverage/
.env
apps/server/src/generated/
```

- [x] **Step 2: Create the protocol package and its failing test**

`packages/protocol/package.json`:
```json
{
  "name": "@nitpilot/protocol",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`packages/protocol/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/protocol/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
```

`packages/protocol/src/brand.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

describe('BRAND', () => {
  it('holds the name-bearing strings the spec fixes', () => {
    expect(BRAND.cli).toBe('nitpilot');
    expect(BRAND.tokenPrefix).toBe('nit_');
    expect(BRAND.teamConfigFile).toBe('.nitpilot.yml');
    expect(BRAND.commentMarker).toBe('nitpilot:v1');
    expect(BRAND.gitRefNamespace).toBe('refs/nitpilot');
    expect(BRAND.commitTrailer).toBe('Nitpilot-Job');
  });

  it('has no empty values', () => {
    for (const value of Object.values(BRAND)) expect(value).not.toBe('');
  });
});
```

- [x] **Step 3: Install the root dev tools and run the test to see it fail**

Run:
```bash
npm install -D typescript@^5 tsx@^4 vitest@^4 @types/node@^22 eslint@^9 @eslint/js@^9 typescript-eslint@^8
npm install zod@^4 -w packages/protocol
npm test -w packages/protocol
```
Expected: FAIL, `Failed to resolve import "./brand"`.

- [x] **Step 4: Write `BRAND` and the package entry**

`packages/protocol/src/brand.ts`:
```ts
/**
 * Every name-bearing string in Nitpilot lives here, so a rename is a one-line change.
 * Never hard-code "nitpilot" anywhere else.
 */
export const BRAND = {
  name: 'Nitpilot',
  cli: 'nitpilot',
  npmPackage: 'nitpilot',
  configDirName: 'nitpilot',
  envPrefix: 'NITPILOT_',
  teamConfigFile: '.nitpilot.yml',
  tokenPrefix: 'nit_',
  commentMarker: 'nitpilot:v1',
  gitRefNamespace: 'refs/nitpilot',
  commitTrailer: 'Nitpilot-Job',
  mcpServerName: 'nitpilot',
  sessionCookie: 'nitpilot_session',
  oauthCookie: 'nitpilot_oauth',
  userAgent: 'nitpilot',
} as const;
```

`packages/protocol/src/index.ts`:
```ts
export * from './brand';
```

- [x] **Step 5: Run the test to see it pass**

Run: `npm test -w packages/protocol`
Expected: PASS, 2 tests.

- [x] **Step 6: Create the server and CLI package stubs**

`apps/server/package.json`:
```json
{
  "name": "@nitpilot/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@nitpilot/protocol": "*"
  }
}
```

`apps/server/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "jsxImportSource": "hono/jsx" },
  "include": ["src", "test", "scripts", "prisma.config.ts", "vitest.config.ts"]
}
```

`apps/server/vitest.config.ts` (Task 12 replaces this with unit/db projects):
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['src/**/*.test.{ts,tsx}'] } });
```

`apps/server/src/version.ts`:
```ts
export const SERVER_VERSION = '0.1.0';
```

`apps/cli/package.json` (Plan 1b fills it in; the npm name is `BRAND.npmPackage`):
```json
{
  "name": "nitpilot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@nitpilot/protocol": "*"
  }
}
```

`apps/cli/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`apps/cli/src/version.ts`:
```ts
export const CLI_VERSION = '0.1.0';
```

- [x] **Step 7: Link the workspaces and check everything**

Run:
```bash
npm install
npm test
npm run typecheck
npm run lint
```
Expected: the protocol tests PASS, the server reports "No test files found, exiting with code 0", typecheck prints nothing, and lint prints nothing.

- [x] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json eslint.config.mjs .gitignore packages apps
git commit -m "chore: npm workspace skeleton with protocol BRAND

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Local Postgres and CI

**Files:**
- Create: `docker-compose.yml`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the workspace scripts from Task 1.
- Produces: Postgres on `localhost:5433` (user/password/db `nitpilot`), and a CI gate that runs migrations, typecheck, lint and every workspace's tests (the CLI's too, which closes the Odyhook gap noted in spec §23).

- [x] **Step 1: Write `docker-compose.yml`**

```yaml
# Local development only. Plan 3 adds the production compose file.
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: nitpilot
      POSTGRES_PASSWORD: nitpilot
      POSTGRES_DB: nitpilot
    ports:
      # 5433 on your machine, because Odyhook's Postgres already uses 5432.
      - "5433:5432"
    volumes:
      - nitpilot_pg:/var/lib/postgresql/data

volumes:
  nitpilot_pg:
```

- [x] **Step 2: Start it and check that it answers**

Run:
```bash
docker compose up -d postgres
docker compose exec postgres pg_isready -U nitpilot
```
Expected: `/var/run/postgresql:5432 - accepting connections`.

- [x] **Step 3: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: typecheck + lint + tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: nitpilot
          POSTGRES_PASSWORD: nitpilot
          POSTGRES_DB: nitpilot
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U nitpilot"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://nitpilot:nitpilot@localhost:5432/nitpilot
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # The script only exists once the server has a Prisma schema (Task 12).
      - run: npm run db:deploy --if-present -w apps/server
      - run: npm run typecheck
      - run: npm run lint
      # Runs every workspace's tests: protocol, server and CLI.
      - run: npm test
```

- [x] **Step 4: Run the same steps locally**

Run: `npm ci && npm run typecheck && npm run lint && npm test`
Expected: everything passes as in Task 1. If the repo has a GitHub remote, push the branch and check that the "CI" workflow is green.

- [x] **Step 5: Commit**

```bash
git add docker-compose.yml .github/workflows/ci.yml
git commit -m "chore: local Postgres on 5433 and CI workflow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Milestone M1: Protocol

Everything that crosses a process boundary (server ↔ CLI, server ↔ agent results, team rules) is a zod schema in `packages/protocol`. Each schema is a runtime validator and a TypeScript type under the same name, so `Severity` is both `z.enum([...])` and `'blocker' | 'major' | 'minor' | 'nit'`. Spec §19 asks for a round-trip test for every schema: encode to JSON, parse it back, get the same value.

### Task 3: Enums and team rules

**Files:**
- Create: `packages/protocol/src/enums.ts`, `packages/protocol/src/enums.test.ts`, `packages/protocol/src/rules.ts`, `packages/protocol/src/rules.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the zod enums (each with its type of the same name) `Severity`, `Category`, `PointStatus`, `PointOrigin`, `Phase`, `Role`, `Attention`, `JobType`, `JobStatus`, `ApplyState`, `MessageKind`, `Resolution`, `Decision`, `EscalationReason`, `Side`, `AgentId`, `AgentMode`, `NotifyKind` and `FailureReason`, plus `TeamRulesSchema`, `type TeamRules` and `DEFAULT_RULES`.

- [x] **Step 1: Write the failing tests**

`packages/protocol/src/enums.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Category, FailureReason, Phase, PointStatus, Severity } from './enums';

describe('enums', () => {
  it('use exactly the spec values', () => {
    expect(Severity.options).toEqual(['blocker', 'major', 'minor', 'nit']);
    expect(Category.options).toEqual(['security', 'bug', 'performance', 'design', 'tests', 'style', 'docs', 'other']);
    expect(PointStatus.options).toEqual(['open', 'addressed', 'resolved', 'escalated']);
    expect(Phase.options).toEqual(['idle', 'reviewing', 'addressing', 'ready', 'escalated', 'closed']);
  });

  it('reject unknown values', () => {
    expect(Severity.safeParse('critical').success).toBe(false);
    expect(Phase.safeParse('done').success).toBe(false);
  });

  it('includes the CLI rejection reasons in FailureReason', () => {
    expect(FailureReason.options).toEqual(expect.arrayContaining(['quota', 'daily_cap', 'branch_moved', 'stale_head']));
  });
});
```

`packages/protocol/src/rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, TeamRulesSchema } from './rules';

describe('TeamRulesSchema', () => {
  it('fills in the spec defaults when the file is empty', () => {
    expect(DEFAULT_RULES).toEqual({
      version: 1,
      max_rounds: 3,
      always_escalate: ['security'],
      auto: { review: true, address: true },
      ignore_paths: ['**/*.lock', 'dist/**'],
      trusted_bots: ['coderabbitai[bot]'],
      debounce_seconds: 30,
      max_points_per_review: 20,
    });
  });

  it('keeps defaults for the keys a team leaves out', () => {
    const rules = TeamRulesSchema.parse({ max_rounds: 5, auto: { address: false } });
    expect(rules.max_rounds).toBe(5);
    expect(rules.auto).toEqual({ review: true, address: false });
    expect(rules.always_escalate).toEqual(['security']);
  });

  it.each([
    [{ max_rounds: 0 }],
    [{ max_rounds: 11 }],
    [{ always_escalate: ['vibes'] }],
    [{ max_points_per_review: 21 }],
    [{ max_round: 3 }],
    [{ version: 2 }],
  ])('rejects %j', (input) => {
    expect(TeamRulesSchema.safeParse(input).success).toBe(false);
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm test -w packages/protocol`
Expected: FAIL, `Failed to resolve import "./enums"` and `"./rules"`.

- [x] **Step 3: Write the enums**

`packages/protocol/src/enums.ts`:
```ts
import { z } from 'zod';

// Each enum is a zod schema (for runtime checks) and a type with the same name.

export const Severity = z.enum(['blocker', 'major', 'minor', 'nit']);
export type Severity = z.infer<typeof Severity>;

export const Category = z.enum(['security', 'bug', 'performance', 'design', 'tests', 'style', 'docs', 'other']);
export type Category = z.infer<typeof Category>;

export const PointStatus = z.enum(['open', 'addressed', 'resolved', 'escalated']);
export type PointStatus = z.infer<typeof PointStatus>;

/** Where a point came from: an agent's review, or a comment on GitHub. */
export const PointOrigin = z.enum(['agent', 'github']);
export type PointOrigin = z.infer<typeof PointOrigin>;

/** Whose turn it is in a chat (spec §9.1). */
export const Phase = z.enum(['idle', 'reviewing', 'addressing', 'ready', 'escalated', 'closed']);
export type Phase = z.infer<typeof Phase>;

export const Role = z.enum(['author', 'reviewer']);
export type Role = z.infer<typeof Role>;

/** Why a person is needed. Stored per participant because "needs you" is personal. */
export const Attention = z.enum(['none', 'decision', 'manual_review', 'failed', 'drafts']);
export type Attention = z.infer<typeof Attention>;

export const JobType = z.enum(['review', 're_review', 'address']);
export type JobType = z.infer<typeof JobType>;

export const JobStatus = z.enum(['queued', 'running', 'done', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;

export const ApplyState = z.enum(['pending', 'applied', 'draft', 'discarded']);
export type ApplyState = z.infer<typeof ApplyState>;

export const MessageKind = z.enum(['point_raised', 'point_reply', 'point_decision', 'job_summary', 'human', 'system']);
export type MessageKind = z.infer<typeof MessageKind>;

/** How the author's agent answered a point. */
export const Resolution = z.enum(['fixed', 'answered', 'declined']);
export type Resolution = z.infer<typeof Resolution>;

/** How the reviewer's agent judged an answer. */
export const Decision = z.enum(['resolve', 'keep_open']);
export type Decision = z.infer<typeof Decision>;

export const EscalationReason = z.enum(['category', 'disagreement', 'round_limit']);
export type EscalationReason = z.infer<typeof EscalationReason>;

/** Which side of a diff a comment is anchored to (GitHub's terms). */
export const Side = z.enum(['LEFT', 'RIGHT']);
export type Side = z.infer<typeof Side>;

export const AgentId = z.enum(['claude-code', 'gemini-cli', 'fake']);
export type AgentId = z.infer<typeof AgentId>;

export const AgentMode = z.enum(['reviewer', 'editor']);
export type AgentMode = z.infer<typeof AgentMode>;

export const NotifyKind = z.enum(['ready', 'escalated', 'manual_review', 'failed', 'drafts']);
export type NotifyKind = z.infer<typeof NotifyKind>;

export const FailureReason = z.enum([
  // How an agent run can end badly (spec §12.2)
  'auth', 'quota', 'max_turns', 'crash', 'timeout', 'no_result',
  // Git and checkout problems (spec §11)
  'stale_head', 'branch_moved', 'setup_failed', 'git_error',
  // The CLI turned the job down
  'daily_cap', 'repo_not_linked', 'unsupported_mode',
]);
export type FailureReason = z.infer<typeof FailureReason>;
```

- [x] **Step 4: Write the team rules schema**

`packages/protocol/src/rules.ts`:
```ts
import { z } from 'zod';
import { Category } from './enums';

/**
 * `.nitpilot.yml`, always read from the repo's default branch (spec §13).
 * `strictObject` rejects unknown keys, so a typo like `max_round` becomes a visible
 * error instead of being silently ignored.
 */
export const TeamRulesSchema = z.strictObject({
  version: z.literal(1).default(1),
  max_rounds: z.number().int().min(1).max(10).default(3),
  always_escalate: z.array(Category).default(['security']),
  auto: z
    .strictObject({
      review: z.boolean().default(true),
      address: z.boolean().default(true),
    })
    .default({ review: true, address: true }),
  ignore_paths: z.array(z.string().min(1)).default(['**/*.lock', 'dist/**']),
  trusted_bots: z.array(z.string().min(1)).default(['coderabbitai[bot]']),
  debounce_seconds: z.number().int().min(0).max(600).default(30),
  max_points_per_review: z.number().int().min(1).max(20).default(20),
});
export type TeamRules = z.infer<typeof TeamRulesSchema>;

/** The rules a repo gets when it has no `.nitpilot.yml`, or an invalid one. */
export const DEFAULT_RULES: TeamRules = TeamRulesSchema.parse({});
```

`packages/protocol/src/index.ts`:
```ts
export * from './brand';
export * from './enums';
export * from './rules';
```

- [x] **Step 5: Run the tests to see them pass**

Run: `npm test -w packages/protocol && npm run typecheck -w packages/protocol`
Expected: PASS (all enum and rules cases), with no type errors.

- [x] **Step 6: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): enums and team rules schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Job bundle and job result

**Files:**
- Create: `packages/protocol/src/job-result.ts`, `packages/protocol/src/job-bundle.ts`, `packages/protocol/src/test-samples.ts`, `packages/protocol/src/job.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: the enums from Task 3.
- Produces:
  - `Snippet` `{startLine, lines[]}`, `NewPoint`, `PointDecision` `{point, decision, comment}`, `PointReply` `{point, resolution, comment}`, `PushInfo` `{from, to}`, `JobResult` `{summary, points, decisions, replies, push}`;
  - `BundlePoint`, `JobBundle` `{jobId, attempt, type, round, maxRounds, apply: 'auto'|'draft', you, pr, git, sinceSha, points, notes, rules}`;
  - `samples.jobResult()` and `samples.jobBundle()` (test data that Plan 1b reuses).
- Points are referenced by their chat-local **number** (P1 → `1`).

- [x] **Step 1: Write the failing test**

`packages/protocol/src/job.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { JobBundle } from './job-bundle';
import { JobResult } from './job-result';
import { jobBundle, jobResult } from './test-samples';

function roundTrip<S extends z.ZodType>(schema: S, value: z.infer<S>) {
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
}

describe('job schemas', () => {
  it('round-trips a job result', () => roundTrip(JobResult, jobResult()));
  it('round-trips a job bundle', () => roundTrip(JobBundle, jobBundle()));

  it('caps a review at 20 points', () => {
    const r = jobResult();
    r.points = Array.from({ length: 21 }, () => r.points[0]!);
    expect(JobResult.safeParse(r).success).toBe(false);
  });

  it('caps a point body at 4,000 characters', () => {
    const r = jobResult();
    r.points[0]!.body = 'x'.repeat(4001);
    expect(JobResult.safeParse(r).success).toBe(false);
  });

  it('allows a bundle for a PR whose fork was deleted', () => {
    const b = jobBundle();
    b.git.headRepoPath = null;
    expect(JobBundle.safeParse(b).success).toBe(true);
  });
});
```

- [x] **Step 2: Run the test to see it fail**

Run: `npm test -w packages/protocol`
Expected: FAIL, `Failed to resolve import "./job-bundle"`.

- [x] **Step 3: Write the result schema**

`packages/protocol/src/job-result.ts`:
```ts
import { z } from 'zod';
import { Category, Decision, Resolution, Severity, Side } from './enums';

/** ±5 lines of code around a point, read by the CLI with `git show` (spec §11 step 7). */
export const Snippet = z.object({
  startLine: z.number().int().positive(),
  lines: z.array(z.string()).max(40),
});
export type Snippet = z.infer<typeof Snippet>;

/** A point raised by a reviewer agent through `add_point`. */
export const NewPoint = z.object({
  path: z.string().min(1).nullable(),
  line: z.number().int().positive().nullable(),
  side: Side.nullable(),
  severity: Severity,
  category: Category,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  snippet: Snippet.nullable(),
});
export type NewPoint = z.infer<typeof NewPoint>;

/** A re-review decision through `decide_point`. `point` is the chat-local number (P3 → 3). */
export const PointDecision = z.object({
  point: z.number().int().positive(),
  decision: Decision,
  comment: z.string().max(4000),
});
export type PointDecision = z.infer<typeof PointDecision>;

/** An address-job answer through `reply_to_point`. */
export const PointReply = z.object({
  point: z.number().int().positive(),
  resolution: Resolution,
  comment: z.string().max(4000),
});
export type PointReply = z.infer<typeof PointReply>;

/** The commit an address job pushed. */
export const PushInfo = z.object({ from: z.string().min(7), to: z.string().min(7) });
export type PushInfo = z.infer<typeof PushInfo>;

/**
 * Everything an agent produced in one job. The CLI buffers tool calls locally and sends
 * this once, in `job.complete`, so a job is all-or-nothing (spec §10).
 */
export const JobResult = z.object({
  summary: z.string().max(4000),
  points: z.array(NewPoint).max(20),
  decisions: z.array(PointDecision),
  replies: z.array(PointReply),
  push: PushInfo.nullable(),
});
export type JobResult = z.infer<typeof JobResult>;
```

- [x] **Step 4: Write the bundle schema**

`packages/protocol/src/job-bundle.ts`:
```ts
import { z } from 'zod';
import { Category, JobType, MessageKind, PointOrigin, PointStatus, Resolution, Role, Severity, Side } from './enums';

/** One entry in a point's thread: a reply, a decision, or a human note about it. */
export const ThreadEntry = z.object({
  author: z.string(),
  kind: MessageKind,
  body: z.string(),
  at: z.string(),
});

/** A point as an agent sees it in `get_job`. */
export const BundlePoint = z.object({
  number: z.number().int().positive(),
  origin: PointOrigin,
  raisedBy: z.string(),
  path: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  side: Side.nullable(),
  severity: Severity,
  category: Category,
  title: z.string(),
  body: z.string(),
  status: PointStatus,
  authorResolution: Resolution.nullable(),
  round: z.number().int().positive(),
  thread: z.array(ThreadEntry),
});
export type BundlePoint = z.infer<typeof BundlePoint>;

/**
 * Everything the CLI needs to run one job, self-contained (spec §10 `job.assign`).
 * `headSha` is the PR head at assignment time: queued jobs follow the latest head.
 */
export const JobBundle = z.object({
  jobId: z.string().min(1),
  attempt: z.number().int().positive(),
  type: JobType,
  round: z.number().int().positive(),
  maxRounds: z.number().int().positive(),
  /** `draft`: do the work but don't publish or push it (Auto is off). */
  apply: z.enum(['auto', 'draft']),
  you: z.object({ login: z.string(), role: Role }),
  pr: z.object({
    repoFullName: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    url: z.string(),
    authorLogin: z.string(),
    baseRef: z.string(),
    headRef: z.string(),
    baseSha: z.string(),
    headSha: z.string(),
  }),
  git: z.object({
    baseCloneUrl: z.string(),
    fetchRef: z.string(),
    /** `null` when the PR came from a fork that has been deleted: nothing can be pushed. */
    headRepoPath: z.string().nullable(),
    headBranch: z.string(),
  }),
  /** For re-reviews: only look at commits after this one. `null` means review everything. */
  sinceSha: z.string().nullable(),
  points: z.array(BundlePoint),
  notes: z.array(z.object({ author: z.string(), body: z.string(), at: z.string() })),
  rules: z.object({
    ignorePaths: z.array(z.string()),
    alwaysEscalate: z.array(Category),
    maxPoints: z.number().int().positive(),
  }),
});
export type JobBundle = z.infer<typeof JobBundle>;
```

- [x] **Step 5: Write the shared samples**

`packages/protocol/src/test-samples.ts`:
```ts
import type { JobBundle } from './job-bundle';
import type { JobResult } from './job-result';

// Realistic sample values for tests in every workspace. Each call returns a fresh copy.

export function jobResult(): JobResult {
  return {
    summary: 'Found a crash on empty input and a missing test.',
    points: [
      {
        path: 'src/orders/list.ts',
        line: 48,
        side: 'RIGHT',
        severity: 'major',
        category: 'bug',
        title: '`parseOrder` crashes on empty input',
        body: 'When `items` is empty, `items[0].id` throws.',
        snippet: { startLine: 43, lines: ['export function parseOrder(items) {', '  return items[0].id;', '}'] },
      },
    ],
    decisions: [],
    replies: [],
    push: null,
  };
}

export function jobBundle(): JobBundle {
  return {
    jobId: 'job_1',
    attempt: 1,
    type: 'review',
    round: 1,
    maxRounds: 3,
    apply: 'auto',
    you: { login: 'leo', role: 'reviewer' },
    pr: {
      repoFullName: 'acme/shop-api',
      number: 142,
      title: 'Cursor pagination for orders',
      body: 'Replaces offset pagination.',
      url: 'https://github.com/acme/shop-api/pull/142',
      authorLogin: 'maya',
      baseRef: 'main',
      headRef: 'feature/cursor-pagination',
      baseSha: 'b'.repeat(40),
      headSha: 'a'.repeat(40),
    },
    git: {
      baseCloneUrl: 'https://github.com/acme/shop-api.git',
      fetchRef: 'refs/pull/142/head',
      headRepoPath: 'acme/shop-api',
      headBranch: 'feature/cursor-pagination',
    },
    sinceSha: null,
    points: [],
    notes: [],
    rules: { ignorePaths: ['**/*.lock'], alwaysEscalate: ['security'], maxPoints: 20 },
  };
}
```

`packages/protocol/src/index.ts`:
```ts
export * from './brand';
export * from './enums';
export * from './rules';
export * from './job-result';
export * from './job-bundle';
export * as samples from './test-samples';
```

- [x] **Step 6: Run the tests to see them pass**

Run: `npm test -w packages/protocol && npm run typecheck -w packages/protocol`
Expected: PASS (5 new tests), with no type errors.

- [x] **Step 7: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): job bundle and job result schemas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Wire messages, close codes and REST shapes

**Files:**
- Create: `packages/protocol/src/envelope.ts`, `packages/protocol/src/cli-messages.ts`, `packages/protocol/src/close-codes.ts`, `packages/protocol/src/api.ts`, `packages/protocol/src/messages.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**
- Consumes: the enums, `JobResult` and `JobBundle`.
- Produces:
  - `PROTOCOL_VERSION = 1`, `PING_SEC = 25`, `LEASE_SEC = 90`, `message(t, dataSchema)` and `encode(msg)`;
  - `RunningJob`, `CliToServer` (union of `hello`, `ping`, `job.progress`, `job.pushing`, `job.complete`, `job.fail`, `job.reject`) and `ServerToCli` (union of `welcome`, `pong`, `ack`, `job.assign`, `job.cancel`, `notify`), each message also exported on its own;
  - `CLOSE_CODES = { reauth: 4401, upgradeCli: 4426, serverRestart: 1012 }`;
  - `CliLoginStartRequest`/`Response`, `CliLoginPollRequest`/`Response`, `MeResponse`, `MyChat`, `MyChatsResponse`.

- [x] **Step 1: Write the failing test**

`packages/protocol/src/messages.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { CliLoginPollResponse, MyChatsResponse } from './api';
import { CliToServer, ServerToCli } from './cli-messages';
import { CLOSE_CODES } from './close-codes';
import { encode } from './envelope';
import { jobBundle, jobResult } from './test-samples';

function roundTrip<S extends z.ZodType>(schema: S, value: z.infer<S>) {
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);
}

const job = { jobId: 'job_1', attempt: 2 };

// Typing the arrays makes TypeScript check every sample against the union too.
const cliMessages: CliToServer[] = [
  { v: 1, t: 'hello', d: { protocol: 1, cliVersion: '0.1.0', device: "Maya's MacBook Pro", agent: { id: 'claude-code', version: '2.1.290', modes: ['reviewer', 'editor'] }, repos: ['acme/shop-api'], concurrency: 1, running: [job], defaults: { autoReview: true, autoAddress: true } } },
  { v: 1, t: 'ping', d: { running: [job] } },
  { v: 1, t: 'job.progress', d: { ...job, stage: 'running_agent', text: 'reading src/orders/list.ts' } },
  { v: 1, t: 'job.pushing', id: 'm1', d: { ...job, from: 'a'.repeat(40), to: 'c'.repeat(40) } },
  { v: 1, t: 'job.complete', id: 'm2', d: { ...job, result: jobResult() } },
  { v: 1, t: 'job.fail', id: 'm3', d: { ...job, reason: 'quota', retryable: true, detail: 'Gemini quota reached' } },
  { v: 1, t: 'job.reject', id: 'm4', d: { ...job, reason: 'daily_cap' } },
];

const serverMessages: ServerToCli[] = [
  { v: 1, t: 'welcome', d: { login: 'maya', pingSec: 25, leaseSec: 90 } },
  { v: 1, t: 'pong', d: {} },
  { v: 1, t: 'ack', re: 'm1', d: { status: 'applied' } },
  { v: 1, t: 'job.assign', d: { bundle: jobBundle() } },
  { v: 1, t: 'job.cancel', d: { ...job, reason: 'pr_closed' } },
  { v: 1, t: 'notify', d: { kind: 'ready', chatId: 'c1', title: 'Ready for your approval', url: 'https://nitpilot.dev/c/acme/shop-api/142' } },
];

const pollResponses: CliLoginPollResponse[] = [
  { status: 'pending' },
  { status: 'approved', token: 'nit_abc' },
  { status: 'denied' },
  { status: 'expired' },
];

describe('CLI → server messages', () => {
  it.each(cliMessages)('round-trips $t', (msg) => roundTrip(CliToServer, msg));

  it('rejects a message type the server does not know', () => {
    expect(CliToServer.safeParse({ v: 1, t: 'job.explode', d: {} }).success).toBe(false);
  });

  it('rejects a CLI that asks for more than 4 concurrent jobs', () => {
    const hello = { v: 1, t: 'hello', d: { protocol: 1, cliVersion: '0.1.0', device: 'x', agent: { id: 'fake', version: null, modes: ['reviewer'] }, repos: [], concurrency: 9, running: [], defaults: { autoReview: true, autoAddress: true } } };
    expect(CliToServer.safeParse(hello).success).toBe(false);
  });
});

describe('server → CLI messages', () => {
  it.each(serverMessages)('round-trips $t', (msg) => roundTrip(ServerToCli, msg));
});

describe('envelope and constants', () => {
  it('encode() adds the protocol version', () => {
    expect(JSON.parse(encode({ t: 'pong', d: {} }))).toEqual({ v: 1, t: 'pong', d: {} });
  });

  it('uses the spec close codes', () => {
    expect(CLOSE_CODES).toEqual({ reauth: 4401, upgradeCli: 4426, serverRestart: 1012 });
  });
});

describe('REST shapes', () => {
  it.each(pollResponses)('round-trips poll status $status', (r) => roundTrip(CliLoginPollResponse, r));

  it('round-trips the chat list', () =>
    roundTrip(MyChatsResponse, {
      chats: [{ id: 'c1', repo: 'acme/shop-api', number: 142, title: 'Cursor pagination', role: 'reviewer', phase: 'ready', round: 2, attention: 'none', url: 'https://nitpilot.dev/c/acme/shop-api/142', updatedAt: '2026-10-07T18:04:00.000Z' }],
    }));
});
```

- [x] **Step 2: Run the test to see it fail**

Run: `npm test -w packages/protocol`
Expected: FAIL, `Failed to resolve import "./api"`.

- [x] **Step 3: Write the envelope and close codes**

`packages/protocol/src/envelope.ts`:
```ts
import { z } from 'zod';

/** Bumped only for breaking changes; the server closes old CLIs with CLOSE_CODES.upgradeCli. */
export const PROTOCOL_VERSION = 1;
/** The CLI pings every 25 s; a running job's lease lasts 90 s (spec §9.4). */
export const PING_SEC = 25;
export const LEASE_SEC = 90;

/**
 * Every WebSocket message has the same envelope: `{ v: 1, t: "<type>", id?, re?, d: {…} }`.
 * `id` names a message that expects an answer; `re` is the id being answered.
 */
export function message<T extends string, D extends z.ZodType>(t: T, d: D) {
  return z.object({
    v: z.literal(1),
    t: z.literal(t),
    id: z.string().optional(),
    re: z.string().optional(),
    d,
  });
}

export function encode(msg: { t: string; d: unknown; id?: string; re?: string }): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}
```

`packages/protocol/src/close-codes.ts`:
```ts
/** WebSocket close codes the server uses (spec §10). */
export const CLOSE_CODES = {
  /** The CLI token is invalid or revoked: run `nitpilot login` again. */
  reauth: 4401,
  /** The CLI speaks an old protocol: upgrade it. */
  upgradeCli: 4426,
  /** The server is restarting: reconnect. */
  serverRestart: 1012,
} as const;
```

- [x] **Step 4: Write the CLI ↔ server messages**

`packages/protocol/src/cli-messages.ts`:
```ts
import { z } from 'zod';
import { message } from './envelope';
import { AgentId, AgentMode, FailureReason, NotifyKind } from './enums';
import { JobBundle } from './job-bundle';
import { JobResult } from './job-result';

/** Every job message carries (jobId, attempt), so answers from an old attempt can be spotted. */
export const RunningJob = z.object({ jobId: z.string().min(1), attempt: z.number().int().positive() });
export type RunningJob = z.infer<typeof RunningJob>;

// ── CLI → server ──────────────────────────────────────────────

export const Hello = message('hello', z.object({
  protocol: z.number().int(),
  cliVersion: z.string(),
  device: z.string().min(1).max(100),
  agent: z.object({ id: AgentId, version: z.string().nullable(), modes: z.array(AgentMode) }),
  /** Repos linked on this machine, as `owner/name`. */
  repos: z.array(z.string()),
  concurrency: z.number().int().min(1).max(4),
  /** Jobs this CLI is still running, e.g. after the laptop slept. */
  running: z.array(RunningJob),
  defaults: z.object({ autoReview: z.boolean(), autoAddress: z.boolean() }),
}));

export const Ping = message('ping', z.object({ running: z.array(RunningJob) }));

export const JobProgress = message('job.progress', RunningJob.extend({
  stage: z.enum(['preparing', 'running_agent', 'pushing', 'finishing']),
  text: z.string().max(200),
}));

/** Sent before `git push` and acknowledged first, so the server recognizes its own push. */
export const JobPushing = message('job.pushing', RunningJob.extend({ from: z.string(), to: z.string() }));

export const JobComplete = message('job.complete', RunningJob.extend({ result: JobResult }));

export const JobFail = message('job.fail', RunningJob.extend({
  reason: FailureReason,
  retryable: z.boolean(),
  detail: z.string().max(2000),
}));

export const JobReject = message('job.reject', RunningJob.extend({ reason: FailureReason }));

export const CliToServer = z.discriminatedUnion('t', [Hello, Ping, JobProgress, JobPushing, JobComplete, JobFail, JobReject]);
export type CliToServer = z.infer<typeof CliToServer>;

// ── server → CLI ──────────────────────────────────────────────

export const Welcome = message('welcome', z.object({
  login: z.string(),
  pingSec: z.number().int().positive(),
  leaseSec: z.number().int().positive(),
}));

export const Pong = message('pong', z.object({}));

/** The answer to job.pushing / job.complete / job.fail / job.reject. `stale` means "old attempt, ignored". */
export const Ack = message('ack', z.object({ status: z.enum(['applied', 'stale']) }));

export const JobAssign = message('job.assign', z.object({ bundle: JobBundle }));

export const JobCancel = message('job.cancel', RunningJob.extend({ reason: z.string() }));

export const Notify = message('notify', z.object({
  kind: NotifyKind,
  chatId: z.string(),
  title: z.string(),
  url: z.string(),
}));

export const ServerToCli = z.discriminatedUnion('t', [Welcome, Pong, Ack, JobAssign, JobCancel, Notify]);
export type ServerToCli = z.infer<typeof ServerToCli>;
```

- [x] **Step 5: Write the REST shapes**

`packages/protocol/src/api.ts`:
```ts
import { z } from 'zod';
import { Attention, Phase, Role } from './enums';

// `nitpilot login` (spec §10, "CLI login")
export const CliLoginStartRequest = z.object({ deviceName: z.string().min(1).max(100) });
export const CliLoginStartResponse = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verifyUrl: z.string(),
  interval: z.number().int().positive(),
  expiresIn: z.number().int().positive(),
});
export const CliLoginPollRequest = z.object({ deviceCode: z.string().min(1) });
export const CliLoginPollResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('approved'), token: z.string() }),
  z.object({ status: z.literal('denied') }),
  z.object({ status: z.literal('expired') }),
]);
export type CliLoginPollResponse = z.infer<typeof CliLoginPollResponse>;

// `nitpilot status`
export const MeResponse = z.object({
  login: z.string(),
  avatarUrl: z.string().nullable(),
  githubAuth: z.enum(['ok', 'needs_reauth']),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const MyChat = z.object({
  id: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  role: Role,
  phase: Phase,
  round: z.number().int().positive(),
  attention: Attention,
  url: z.string(),
  updatedAt: z.string(),
});
export type MyChat = z.infer<typeof MyChat>;
export const MyChatsResponse = z.object({ chats: z.array(MyChat) });
export type MyChatsResponse = z.infer<typeof MyChatsResponse>;
```

`packages/protocol/src/index.ts`:
```ts
export * from './brand';
export * from './enums';
export * from './rules';
export * from './job-result';
export * from './job-bundle';
export * from './envelope';
export * from './cli-messages';
export * from './close-codes';
export * from './api';
export * as samples from './test-samples';
```

- [x] **Step 6: Run the tests to see them pass**

Run: `npm test -w packages/protocol && npm run typecheck -w packages/protocol && npm run lint`
Expected: PASS, with no type or lint errors.

- [x] **Step 7: Commit**

```bash
git add packages/protocol
git commit -m "feat(protocol): CLI wire messages, close codes and REST shapes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Milestone M2: The engine

The engine is Nitpilot's brain: given a chat's state and one event, it returns the new state, the timeline items to show and the commands to run (queue a job, post a review, notify someone). It's a **pure function**, like a Redux reducer: no database, no network, no clock (the time is passed in). That makes every workflow rule testable as a plain table of "state + event → expected output", with no mocks. Spec §9 is the source for every rule here.

All engine files live in `apps/server/src/engine/`. Tests use the builders from `test-builders.ts` and a small cast of characters:
- **maya** is the PR author and uses Nitpilot.
- **leo** is a requested reviewer and uses Nitpilot.
- **sam** is a human reviewer who doesn't use Nitpilot.
- **coderabbitai[bot]** is a trusted review bot.

### Task 6: Engine types, rules parser and test builders

**Files:**
- Create: `apps/server/src/engine/types.ts`, `apps/server/src/engine/context.ts`, `apps/server/src/engine/state.ts`, `apps/server/src/engine/rules.ts`, `apps/server/src/engine/rules.test.ts`, `apps/server/src/engine/test-builders.ts`, `apps/server/src/engine/purity.test.ts`
- Create: `docs/why/pure-engine.md`

**Interfaces:**
- Consumes: protocol enums, `TeamRules`, `DEFAULT_RULES`, `JobResult`, `NewPoint`, `Snippet`.
- Produces (later tasks use these exact names):
  - `types.ts`: `Person`, `ParticipantState`, `PointState`, `JobView`, `ChatState`, `ExternalComment`, `ExternalReview`, `DomainEvent`, `ParticipantKey`, `Command`, `NewItem`, `DecideInput`, `DecideOutput`.
  - `context.ts`: `Ctx`, `Ev<T>`, `emit(ctx, command)`, `say(ctx, item)`, `system(ctx, body, data?)`, `addMs(date, ms)`.
  - `state.ts`: `author`, `reviewers`, `participant`, `ensureParticipant`, `onNitpilot`, `activeJobs`, `activeJobFor`, `isActionable`, `pointByNumber`, `pointByThread`, `nextPointNumber`, `who`, `pointList`.
  - `rules.ts`: `parseTeamRules(text: string | null): { rules: TeamRules; error: string | null }`.
  - `test-builders.ts`: `T0`, `person`, `participantOf`, `chatState`, `agentToAgent`, `pointOf`, `jobOf`, `result`, `newPoint`, `rulesWith`, and the cast `maya`, `leo`, `sam`, `rabbit`.

- [x] **Step 1: Install the server's engine dependencies**

Run: `npm install yaml@^2 zod@^4 -w apps/server`
Expected: `added … packages`.

- [x] **Step 2: Write the failing tests**

`apps/server/src/engine/rules.test.ts`:
```ts
import { DEFAULT_RULES } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { parseTeamRules } from './rules';

describe('parseTeamRules', () => {
  it('uses the defaults when the file is missing', () => {
    expect(parseTeamRules(null)).toEqual({ rules: DEFAULT_RULES, error: null });
  });

  it('uses the defaults for an empty file', () => {
    expect(parseTeamRules('')).toEqual({ rules: DEFAULT_RULES, error: null });
  });

  it('reads a valid file', () => {
    const { rules, error } = parseTeamRules('version: 1\nmax_rounds: 5\nalways_escalate: [security, bug]\n');
    expect(error).toBeNull();
    expect(rules.max_rounds).toBe(5);
    expect(rules.always_escalate).toEqual(['security', 'bug']);
  });

  it('falls back to the defaults and explains invalid YAML', () => {
    const { rules, error } = parseTeamRules('max_rounds: [unclosed');
    expect(rules).toEqual(DEFAULT_RULES);
    expect(error).toMatch(/^\.nitpilot\.yml is not valid YAML/);
  });

  it('falls back to the defaults and names the bad key', () => {
    const { rules, error } = parseTeamRules('max_rounds: 99\n');
    expect(rules).toEqual(DEFAULT_RULES);
    expect(error).toMatch(/max_rounds/);
  });
});
```

`apps/server/src/engine/purity.test.ts`:
```ts
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
```

- [x] **Step 3: Run the tests to see them fail**

Run: `npm test -w apps/server`
Expected: `rules.test.ts` FAILS with `Failed to resolve import "./rules"`. `purity.test.ts` PASSES already, because the rule has existed since Task 1 (it's a guard test, not a red/green one).

- [x] **Step 4: Write the engine types**

`apps/server/src/engine/types.ts`:
```ts
import type {
  ApplyState, Attention, Category, EscalationReason, FailureReason, JobResult, JobStatus, JobType,
  MessageKind, NotifyKind, Phase, PointOrigin, PointStatus, Resolution, Role, Severity, Side, Snippet, TeamRules,
} from '@nitpilot/protocol';

/** A person on GitHub. `userId` is their Nitpilot account, or null when they don't use Nitpilot. */
export type Person = { githubId: string; login: string; isBot: boolean; userId: string | null };

/** A person in one chat, in one role. Identified by `githubId + role`. */
export type ParticipantState = {
  githubId: string;
  login: string;
  role: Role;
  userId: string | null;
  isBot: boolean;
  /** Personal Auto switch. Always true in Plan 1. */
  auto: boolean;
  /** For reviewers: still a reviewer of this PR as far as Nitpilot is concerned. */
  requested: boolean;
  /** The head commit this reviewer's agent last reviewed; re-reviews start from here. */
  lastReviewedSha: string | null;
  attention: Attention;
};

/** One review point. Identified by its chat-local `number` (shown as P1, P2, …). */
export type PointState = {
  number: number;
  /** githubId of the reviewer who raised it. */
  raisedBy: string;
  origin: PointOrigin;
  jobId: string | null;
  /** Set when the point lives on GitHub: a GitHub comment, or our agent's comment posted there. */
  githubCommentId: string | null;
  githubThreadRootId: string | null;
  path: string | null;
  line: number | null;
  side: Side | null;
  commitSha: string | null;
  severity: Severity;
  category: Category;
  title: string;
  body: string;
  snippet: Snippet | null;
  status: PointStatus;
  authorResolution: Resolution | null;
  escalationReason: EscalationReason | null;
  /** Points from untrusted people never trigger automatic work (spec §6.1). */
  trusted: boolean;
  round: number;
};

/** A read-only view of a job. Jobs only change through commands. */
export type JobView = {
  id: string;
  participantGithubId: string;
  role: Role;
  jobType: JobType;
  status: JobStatus;
  round: number;
  attempt: number;
  headSha: string;
  applyState: ApplyState;
};

/** Everything the engine knows about one PR chat. */
export type ChatState = {
  phase: Phase;
  round: number;
  addressPasses: number;
  headSha: string;
  isDraft: boolean;
  /** The PR author is trusted (OWNER, MEMBER, COLLABORATOR or a trusted bot). */
  trusted: boolean;
  merged: boolean;
  closed: boolean;
  authorGithubId: string;
  participants: ParticipantState[];
  points: PointState[];
  /** Only jobs that are queued or running (plus any this decide() call changed). */
  jobs: JobView[];
};

/** A comment from GitHub, already normalized by the platform adapter. */
export type ExternalComment = {
  id: string;
  /** The root comment of the thread this replies to, or null for a new top-level comment. */
  threadRootId: string | null;
  author: Person;
  trusted: boolean;
  body: string;
  path: string | null;
  line: number | null;
  side: Side | null;
  commitSha: string | null;
};

export type ExternalReview = {
  id: string;
  author: Person;
  trusted: boolean;
  state: 'approved' | 'changes_requested' | 'commented';
  body: string;
  comments: ExternalComment[];
};

/** Everything that can happen to a chat (spec §9 DomainEvent). The same for every platform. */
export type DomainEvent =
  | { type: 'pr_opened'; author: Person; reviewers: Person[] }
  | { type: 'pr_reopened' }
  | { type: 'pr_ready' }
  | { type: 'pr_to_draft' }
  | { type: 'pr_closed'; merged: boolean }
  | { type: 'review_requested'; reviewer: Person }
  | { type: 'review_request_removed'; reviewer: Person }
  | { type: 'head_updated'; before: string; after: string; ours: boolean }
  | { type: 'external_comment'; comment: ExternalComment }
  | { type: 'external_comment_deleted'; commentId: string }
  | { type: 'external_review_submitted'; review: ExternalReview }
  | { type: 'thread_resolved'; threadRootId: string }
  | { type: 'thread_unresolved'; threadRootId: string }
  | { type: 'job_completed'; jobId: string; result: JobResult }
  | { type: 'job_failed'; jobId: string; reason: FailureReason; retryable: boolean }
  | { type: 'human_note'; author: Person; body: string }
  | { type: 'manual_review'; reviewer: Person }
  | { type: 'timer'; key: string };

export type ParticipantKey = { githubId: string; role: Role };

/** Side effects the engine asks for. The dispatcher turns them into Job and Task rows. */
export type Command =
  | { type: 'enqueue_job'; participant: ParticipantKey; jobType: JobType; round: number; sinceSha: string | null; applyState: 'pending' | 'draft' }
  | { type: 'cancel_jobs'; jobIds: string[]; reason: string }
  | { type: 'complete_job'; jobId: string; applyState: 'applied' | 'draft'; result: JobResult }
  | { type: 'retry_job'; jobId: string; runAfter: Date; refundAttempt: boolean }
  | { type: 'fail_job'; jobId: string; reason: FailureReason }
  | { type: 'schedule'; key: string; at: Date }
  | { type: 'unschedule'; key: string }
  | { type: 'upsert_summary' }
  | { type: 'post_review'; reviewerGithubId: string; pointNumbers: number[] }
  | { type: 'post_thread_replies'; asGithubId: string; replies: { pointNumber: number; body: string }[] }
  | { type: 'notify'; userIds: string[]; kind: NotifyKind; pointNumbers: number[] };

/** One new item for the chat timeline. `author` null means a system event. */
export type NewItem = {
  kind: MessageKind;
  author: { githubId: string; login: string } | null;
  pointNumber: number | null;
  jobId: string | null;
  body: string;
  data: Record<string, unknown> | null;
};

export type DecideInput = { chat: ChatState; rules: TeamRules; event: DomainEvent; now: Date };
export type DecideOutput = { chat: ChatState; timeline: NewItem[]; commands: Command[] };
```

- [x] **Step 5: Write the context and state helpers**

`apps/server/src/engine/context.ts`:
```ts
import type { TeamRules } from '@nitpilot/protocol';
import type { ChatState, Command, DomainEvent, NewItem } from './types';

/** The working state of one decide() call. Handlers change `chat` in place and append items and commands. */
export type Ctx = {
  chat: ChatState;
  rules: TeamRules;
  now: Date;
  timeline: NewItem[];
  commands: Command[];
};

/** One event type out of the union: `Ev<'pr_closed'>` is `{ type: 'pr_closed'; merged: boolean }`. */
export type Ev<T extends DomainEvent['type']> = Extract<DomainEvent, { type: T }>;

export function emit(ctx: Ctx, command: Command): void {
  ctx.commands.push(command);
}

export function say(ctx: Ctx, item: Pick<NewItem, 'kind' | 'body'> & Partial<NewItem>): void {
  ctx.timeline.push({ author: null, pointNumber: null, jobId: null, data: null, ...item });
}

export function system(ctx: Ctx, body: string, data: Record<string, unknown> | null = null): void {
  say(ctx, { kind: 'system', body, data });
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}
```

`apps/server/src/engine/state.ts`:
```ts
import type { JobStatus, Role } from '@nitpilot/protocol';
import type { ChatState, JobView, ParticipantState, Person, PointState } from './types';

const ACTIVE: readonly JobStatus[] = ['queued', 'running'];

export function author(chat: ChatState): ParticipantState | undefined {
  return chat.participants.find((p) => p.role === 'author');
}

export function reviewers(chat: ChatState): ParticipantState[] {
  return chat.participants.filter((p) => p.role === 'reviewer');
}

export function participant(chat: ChatState, githubId: string, role: Role): ParticipantState | undefined {
  return chat.participants.find((p) => p.githubId === githubId && p.role === role);
}

/** Find a participant or add them. Keeps their login and Nitpilot account up to date. */
export function ensureParticipant(chat: ChatState, person: Person, role: Role): ParticipantState {
  const existing = participant(chat, person.githubId, role);
  if (existing) {
    existing.login = person.login;
    existing.userId = person.userId;
    return existing;
  }
  const created: ParticipantState = {
    githubId: person.githubId,
    login: person.login,
    role,
    userId: person.userId,
    isBot: person.isBot,
    auto: true,
    requested: false,
    lastReviewedSha: null,
    attention: 'none',
  };
  chat.participants.push(created);
  return created;
}

/** True when this person runs Nitpilot, so their agent can do work. Bots never do. */
export function onNitpilot(p: ParticipantState): boolean {
  return p.userId !== null && !p.isBot;
}

export function activeJobs(chat: ChatState): JobView[] {
  return chat.jobs.filter((j) => ACTIVE.includes(j.status));
}

export function activeJobFor(chat: ChatState, p: ParticipantState): JobView | undefined {
  return activeJobs(chat).find((j) => j.participantGithubId === p.githubId && j.role === p.role);
}

/** A point the author's side should work on now (spec §9.3). */
export function isActionable(pt: PointState): boolean {
  return pt.status === 'open' && pt.trusted;
}

export function pointByNumber(chat: ChatState, n: number): PointState | undefined {
  return chat.points.find((p) => p.number === n);
}

/** The point a GitHub thread belongs to, found by the thread's root comment id. */
export function pointByThread(chat: ChatState, rootId: string): PointState | undefined {
  return chat.points.find((p) => p.githubThreadRootId === rootId || p.githubCommentId === rootId);
}

export function nextPointNumber(chat: ChatState): number {
  return chat.points.reduce((max, p) => Math.max(max, p.number), 0) + 1;
}

/** The author field of a timeline item. */
export function who(p: { githubId: string; login: string }): { githubId: string; login: string } {
  return { githubId: p.githubId, login: p.login };
}

/** "P1, P3" */
export function pointList(points: PointState[]): string {
  return points.map((p) => `P${p.number}`).join(', ');
}
```

- [x] **Step 6: Write the rules parser**

`apps/server/src/engine/rules.ts`:
```ts
import { BRAND, DEFAULT_RULES, TeamRulesSchema, type TeamRules } from '@nitpilot/protocol';
import { parse as parseYaml } from 'yaml';

export type ParsedRules = { rules: TeamRules; error: string | null };

/**
 * Turn the text of `.nitpilot.yml` (null when the file is missing) into team rules.
 * Never throws: on any problem the defaults apply and `error` explains why (spec §13).
 */
export function parseTeamRules(text: string | null): ParsedRules {
  if (text === null) return { rules: DEFAULT_RULES, error: null };

  let data: unknown;
  try {
    data = parseYaml(text) ?? {};
  } catch (err) {
    return { rules: DEFAULT_RULES, error: `${BRAND.teamConfigFile} is not valid YAML: ${(err as Error).message}` };
  }

  const parsed = TeamRulesSchema.safeParse(data);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(file)'}: ${i.message}`).join('; ');
    return { rules: DEFAULT_RULES, error: `${BRAND.teamConfigFile}: ${problems}` };
  }
  return { rules: parsed.data, error: null };
}
```

- [x] **Step 7: Write the test builders**

`apps/server/src/engine/test-builders.ts`:
```ts
import { DEFAULT_RULES, type JobResult, type JobType, type NewPoint, type Role, type TeamRules } from '@nitpilot/protocol';
import type { ChatState, JobView, ParticipantState, Person, PointState } from './types';

// Builders for engine tests. Each returns a fresh object; pass overrides for what a test cares about.

export const T0 = new Date('2026-10-07T18:00:00.000Z');

export function person(login: string, over: Partial<Person> = {}): Person {
  return { githubId: `gh-${login}`, login, isBot: false, userId: `user-${login}`, ...over };
}

/** The cast. */
export const maya = person('maya');                                              // author, on Nitpilot
export const leo = person('leo');                                                // reviewer, on Nitpilot
export const sam = person('sam', { userId: null });                              // human reviewer, not on Nitpilot
export const rabbit = person('coderabbitai[bot]', { isBot: true, userId: null }); // trusted review bot

export function participantOf(p: Person, role: Role, over: Partial<ParticipantState> = {}): ParticipantState {
  return {
    githubId: p.githubId,
    login: p.login,
    role,
    userId: p.userId,
    isBot: p.isBot,
    auto: true,
    requested: role === 'reviewer',
    lastReviewedSha: null,
    attention: 'none',
    ...over,
  };
}

export function chatState(over: Partial<ChatState> = {}): ChatState {
  return {
    phase: 'idle',
    round: 1,
    addressPasses: 0,
    headSha: 'head1',
    isDraft: false,
    trusted: true,
    merged: false,
    closed: false,
    authorGithubId: maya.githubId,
    participants: [],
    points: [],
    jobs: [],
    ...over,
  };
}

/** maya opened the PR and requested leo; both use Nitpilot. */
export function agentToAgent(over: Partial<ChatState> = {}): ChatState {
  return chatState({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer')], ...over });
}

export function pointOf(number: number, raisedBy: Person, over: Partial<PointState> = {}): PointState {
  return {
    number,
    raisedBy: raisedBy.githubId,
    origin: 'agent',
    jobId: 'job-review-1',
    githubCommentId: null,
    githubThreadRootId: null,
    path: 'src/orders/list.ts',
    line: 48,
    side: 'RIGHT',
    commitSha: 'head1',
    severity: 'major',
    category: 'bug',
    title: `Point ${number}`,
    body: 'Explanation.',
    snippet: null,
    status: 'open',
    authorResolution: null,
    escalationReason: null,
    trusted: true,
    round: 1,
    ...over,
  };
}

export function jobOf(id: string, p: Person, role: Role, jobType: JobType, over: Partial<JobView> = {}): JobView {
  return {
    id,
    participantGithubId: p.githubId,
    role,
    jobType,
    status: 'running',
    round: 1,
    attempt: 1,
    headSha: 'head1',
    applyState: 'pending',
    ...over,
  };
}

export function newPoint(over: Partial<NewPoint> = {}): NewPoint {
  return {
    path: 'src/orders/list.ts',
    line: 48,
    side: 'RIGHT',
    severity: 'major',
    category: 'bug',
    title: '`parseOrder` crashes on empty input',
    body: 'When `items` is empty, `items[0].id` throws.',
    snippet: null,
    ...over,
  };
}

export function result(over: Partial<JobResult> = {}): JobResult {
  return { summary: 'Done.', points: [], decisions: [], replies: [], push: null, ...over };
}

export function rulesWith(over: Partial<TeamRules> = {}): TeamRules {
  return { ...DEFAULT_RULES, ...over };
}
```

- [x] **Step 8: Run the tests to see them pass**

Run: `npm test -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (5 rules tests and 5 purity tests), with no type or lint errors.

- [x] **Step 9: Write the explainer**

`docs/why/pure-engine.md`:
```markdown
# Why the engine is a pure function

**In one sentence:** every Nitpilot workflow rule lives in `decide()`, which works like a Redux reducer: it takes the current state and one event and returns the next state, with no I/O.

## The React analogy

In Redux you write `reducer(state, action) → newState` and keep side effects (fetching, storage) out of it, in middleware. Nitpilot does the same:

| Redux | Nitpilot |
|---|---|
| `state` | `ChatState`: the PR chat's phase, participants, points and active jobs |
| `action` | `DomainEvent`: "PR opened", "review job finished", "comment posted" |
| `reducer` | `decide({ chat, rules, event, now })` in `apps/server/src/engine/decide.ts` |
| middleware doing the effects | the dispatcher (`chats/dispatch.ts`) and the task runner (`tasks/runner.ts`) |

`decide` returns three things: the new `chat`, the `timeline` items to show, and `commands` such as "queue a review job for Leo" or "post a GitHub review". It never does them itself; it only asks.

## Why bother

- **Tests are tables.** "Given this chat and this event, expect these commands." No database, no fake GitHub, no timers. Look at `engine/*.test.ts`.
- **It's deterministic.** Even the current time is passed in as `now`, so a test about a 30-second debounce doesn't wait 30 seconds.
- **Bugs are reproducible.** Load a chat, replay the event, get the same answer.

## How it's enforced

ESLint's `no-restricted-imports` rule (in `eslint.config.mjs`) fails the build if any file in `engine/` imports Prisma, Hono, the GitHub adapter or `node:fs`. `engine/purity.test.ts` checks that the rule keeps working.
```

- [x] **Step 10: Commit**

```bash
git add apps/server package.json package-lock.json docs/why/pure-engine.md
git commit -m "feat(engine): types, rules parser, test builders and purity guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: PR lifecycle and reviewer events

**Files:**
- Create: `apps/server/src/engine/jobs.ts`, `apps/server/src/engine/points.ts`, `apps/server/src/engine/advance.ts`, `apps/server/src/engine/lifecycle.ts`, `apps/server/src/engine/decide.ts`, `apps/server/src/engine/lifecycle.test.ts`
- Modify: `apps/server/src/engine/test-builders.ts` (add `run`, `commandsOf`)

**Interfaces:**
- Consumes: everything from Task 6.
- Produces:
  - `jobs.ts`: `autoFor(ctx, p, jobType)`, `enqueueJob(ctx, p, jobType, sinceSha): boolean`, `cancelJobs(ctx, jobs, reason)`, `startReview(ctx, reviewer, { manual? }): boolean`.
  - `points.ts`: `RaisedPoint`, `raisePoint(ctx, input): PointState`, `escalatePoints(ctx, points, reason)`.
  - `advance.ts`: `advance(ctx)`, the "what happens next once nobody is busy" rule from spec §9.3.
  - `decide.ts`: `decide(input: DecideInput): DecideOutput`.
  - `test-builders.ts`: `run(chat, event, { rules?, now? })` and `commandsOf(out, type)`.

Rules from the spec covered here:
- **§6.1 trust gate:** untrusted PRs wait for a manual "Review".
- **§9.1:** draft PRs stay idle, and closing cancels every job.
- **§9.2:** removing a reviewer withdraws their unresolved agent points.
- **§9.4:** at most one active job per participant.
- **§13:** `auto.review: false` makes the job a draft.

- [x] **Step 1: Add `run` and `commandsOf` to the test builders**

Append to `apps/server/src/engine/test-builders.ts`:
```ts
import { decide } from './decide';
import type { Command, DecideOutput, DomainEvent } from './types';

/** Run one event through decide() with default rules unless overridden. */
export function run(chat: ChatState, event: DomainEvent, opts: { rules?: Partial<TeamRules>; now?: Date } = {}): DecideOutput {
  return decide({ chat, rules: rulesWith(opts.rules), event, now: opts.now ?? T0 });
}

/** The commands of one type, typed: `commandsOf(out, 'enqueue_job')[0].jobType`. */
export function commandsOf<T extends Command['type']>(out: DecideOutput, type: T): Extract<Command, { type: T }>[] {
  return out.commands.filter((c): c is Extract<Command, { type: T }> => c.type === type);
}
```
Move the two new `import` lines to the top of the file with the other imports.

- [x] **Step 2: Write the failing tests**

`apps/server/src/engine/lifecycle.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  agentToAgent, chatState, commandsOf, jobOf, leo, maya, participantOf, pointOf, run, sam,
} from './test-builders';

describe('pr_opened', () => {
  it('queues a review for a requested reviewer who uses Nitpilot', () => {
    const out = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [leo] });
    expect(out.chat.phase).toBe('reviewing');
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 'review', round: 1, sinceSha: null, applyState: 'pending' },
    ]);
    expect(out.chat.participants.map((p) => [p.login, p.role, p.requested])).toEqual([
      ['maya', 'author', false],
      ['leo', 'reviewer', true],
    ]);
  });

  it('stays idle when no reviewer uses Nitpilot', () => {
    const out = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [sam] });
    expect(out.chat.phase).toBe('idle');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('stays idle for a draft PR', () => {
    const out = run(chatState({ isDraft: true }), { type: 'pr_opened', author: maya, reviewers: [leo] });
    expect(out.chat.phase).toBe('idle');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('waits for a manual review when the PR is from an outside contributor', () => {
    const out = run(chatState({ trusted: false }), { type: 'pr_opened', author: maya, reviewers: [leo] });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('manual_review');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'manual_review', pointNumbers: [] }]);
  });

  it('queues a draft-mode review when the team turned auto-review off', () => {
    const out = run(chatState(), { type: 'pr_opened', author: maya, reviewers: [leo] }, { rules: { auto: { review: false, address: true } } });
    expect(commandsOf(out, 'enqueue_job')[0]!.applyState).toBe('draft');
  });
});

describe('manual_review', () => {
  it('starts the review the trust gate held back and clears the attention', () => {
    const chat = chatState({ trusted: false, participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { attention: 'manual_review' })] });
    const out = run(chat, { type: 'manual_review', reviewer: leo });
    expect(commandsOf(out, 'enqueue_job')).toHaveLength(1);
    expect(out.chat.participants[1]!.attention).toBe('none');
    expect(out.chat.phase).toBe('reviewing');
  });
});

describe('review_requested', () => {
  it('queues a re-review from the last reviewed commit for someone who reviewed before', () => {
    const chat = agentToAgent({ participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { requested: false, lastReviewedSha: 'head0' })] });
    const out = run(chat, { type: 'review_requested', reviewer: leo });
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 're_review', sinceSha: 'head0' });
  });

  it('does not queue a second job for a busy reviewer', () => {
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-1', leo, 'reviewer', 'review')] });
    const out = run(chat, { type: 'review_requested', reviewer: leo });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it("waits while the author's agent is fixing", () => {
    const chat = agentToAgent({ phase: 'addressing', participants: [participantOf(maya, 'author')], jobs: [jobOf('job-a', maya, 'author', 'address')] });
    const out = run(chat, { type: 'review_requested', reviewer: leo });
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.requested).toBe(true);
  });
});

describe('review_request_removed', () => {
  it("cancels the reviewer's job, withdraws their points and settles", () => {
    const chat = agentToAgent({
      phase: 'reviewing',
      points: [pointOf(1, leo)],
      jobs: [jobOf('job-rr', leo, 'reviewer', 're_review')],
    });
    const out = run(chat, { type: 'review_request_removed', reviewer: leo });
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-rr'], reason: 'reviewer_removed' }]);
    expect(out.chat.points[0]!.status).toBe('resolved');
    expect(out.chat.phase).toBe('ready');
    // leo is no longer a reviewer, so nobody is told it's ready.
    expect(commandsOf(out, 'notify')).toEqual([]);
  });
});

describe('closing, reopening and drafts', () => {
  it('cancels active jobs when the PR closes', () => {
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-1', leo, 'reviewer', 'review')] });
    const out = run(chat, { type: 'pr_closed', merged: true });
    expect(out.chat).toMatchObject({ phase: 'closed', closed: true, merged: true });
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-1'], reason: 'pr_closed' }]);
  });

  it('restarts with a re-review when reopened', () => {
    const chat = agentToAgent({
      phase: 'closed',
      closed: true,
      participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    });
    const out = run(chat, { type: 'pr_reopened' });
    expect(out.chat.closed).toBe(false);
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 're_review', sinceSha: 'head1' });
  });

  it('pauses on draft and starts again when ready', () => {
    const reviewing = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-1', leo, 'reviewer', 'review')] });
    const drafted = run(reviewing, { type: 'pr_to_draft' });
    expect(drafted.chat.phase).toBe('idle');
    expect(commandsOf(drafted, 'cancel_jobs')).toHaveLength(1);

    const ready = run(drafted.chat, { type: 'pr_ready' });
    expect(ready.chat.phase).toBe('reviewing');
    expect(commandsOf(ready, 'enqueue_job')).toHaveLength(1);
  });
});

describe('human_note', () => {
  it('adds a human message and changes nothing else', () => {
    const chat = agentToAgent({ phase: 'reviewing' });
    const out = run(chat, { type: 'human_note', author: maya, body: 'Keep the public API stable.' });
    expect(out.timeline).toEqual([{ kind: 'human', author: { githubId: maya.githubId, login: 'maya' }, pointNumber: null, jobId: null, body: 'Keep the public API stable.', data: null }]);
    expect(out.chat).toEqual(chat);
  });
});

describe('decide()', () => {
  it('never changes its input', () => {
    const chat = agentToAgent({ points: [pointOf(1, leo)] });
    const before = structuredClone(chat);
    run(chat, { type: 'pr_closed', merged: false });
    expect(chat).toEqual(before);
  });

  it('asks for a summary update in agent-to-agent mode once agent points exist', () => {
    const out = run(agentToAgent({ points: [pointOf(1, leo)] }), { type: 'human_note', author: maya, body: 'hi' });
    expect(commandsOf(out, 'upsert_summary')).toHaveLength(1);
  });

  it('never asks for a summary when the author is not on Nitpilot', () => {
    const chat = agentToAgent({ participants: [participantOf({ ...maya, userId: null }, 'author'), participantOf(leo, 'reviewer')], points: [pointOf(1, leo)] });
    const out = run(chat, { type: 'human_note', author: leo, body: 'hi' });
    expect(commandsOf(out, 'upsert_summary')).toEqual([]);
  });
});
```

- [x] **Step 3: Run the tests to see them fail**

Run: `npm run test -w apps/server -- src/engine/lifecycle.test.ts`
Expected: FAIL, `Failed to resolve import "./decide"`.

- [x] **Step 4: Write `jobs.ts`**

`apps/server/src/engine/jobs.ts`:
```ts
import type { JobType } from '@nitpilot/protocol';
import { emit, system, type Ctx } from './context';
import { activeJobFor, activeJobs, onNitpilot } from './state';
import type { JobView, ParticipantState } from './types';

/** Auto is on when the team allows it and the person has it on (personal Auto is always on in Plan 1). */
export function autoFor(ctx: Ctx, p: ParticipantState, jobType: JobType): boolean {
  const teamAllows = jobType === 'address' ? ctx.rules.auto.address : ctx.rules.auto.review;
  return teamAllows && p.auto;
}

/**
 * Queue a job for a participant. Returns false when they can't take one: they're not on
 * Nitpilot, or they already have an active job (at most one each, spec §9.4).
 */
export function enqueueJob(ctx: Ctx, p: ParticipantState, jobType: JobType, sinceSha: string | null): boolean {
  if (!onNitpilot(p) || activeJobFor(ctx.chat, p)) return false;
  const applyState = autoFor(ctx, p, jobType) ? 'pending' : 'draft';
  // Add it to the working copy too, so later rules in this same decide() call see it.
  // The id is a placeholder; the dispatcher creates the real row from the command.
  ctx.chat.jobs.push({
    id: `new:${ctx.commands.length}`,
    participantGithubId: p.githubId,
    role: p.role,
    jobType,
    status: 'queued',
    round: ctx.chat.round,
    attempt: 0,
    headSha: ctx.chat.headSha,
    applyState,
  });
  if (p.attention === 'failed' || p.attention === 'manual_review') p.attention = 'none';
  emit(ctx, {
    type: 'enqueue_job',
    participant: { githubId: p.githubId, role: p.role },
    jobType,
    round: ctx.chat.round,
    sinceSha,
    applyState,
  });
  return true;
}

export function cancelJobs(ctx: Ctx, jobs: JobView[], reason: string): void {
  if (jobs.length === 0) return;
  for (const j of jobs) j.status = 'cancelled';
  emit(ctx, { type: 'cancel_jobs', jobIds: jobs.map((j) => j.id), reason });
}

/**
 * Start a review (or a re-review) for one reviewer, if the rules allow it right now.
 * `manual` is a person pressing "Review" on a PR from an outside contributor (spec §6.1).
 */
export function startReview(ctx: Ctx, reviewer: ParticipantState, opts: { manual?: boolean } = {}): boolean {
  const chat = ctx.chat;
  if (chat.phase === 'closed' || chat.isDraft) return false;
  if (!reviewer.requested || !onNitpilot(reviewer)) return false;
  // While the author's agent is fixing, wait: reviews start after that pass (results.ts).
  if (activeJobs(chat).some((j) => j.jobType === 'address')) return false;

  if (!chat.trusted && !opts.manual) {
    if (reviewer.attention !== 'manual_review') {
      reviewer.attention = 'manual_review';
      emit(ctx, { type: 'notify', userIds: [reviewer.userId!], kind: 'manual_review', pointNumbers: [] });
      system(ctx, `Waiting for ${reviewer.login} to start the review: the PR is from an outside contributor`);
    }
    return false;
  }

  const jobType = reviewer.lastReviewedSha ? 're_review' : 'review';
  if (!enqueueJob(ctx, reviewer, jobType, reviewer.lastReviewedSha)) return false;
  chat.phase = 'reviewing';
  system(ctx, `Round ${chat.round}: ${reviewer.login}'s agent is reviewing`, { reviewer: reviewer.login });
  return true;
}
```

- [x] **Step 5: Write `points.ts`**

`apps/server/src/engine/points.ts`:
```ts
import type { EscalationReason, NewPoint } from '@nitpilot/protocol';
import { emit, say, system, type Ctx } from './context';
import { nextPointNumber, onNitpilot, pointList } from './state';
import type { PointState } from './types';

const REASON_TEXT: Record<EscalationReason, string> = {
  category: 'this category always goes to a person',
  disagreement: 'the agents disagree',
  round_limit: 'the round limit was reached',
};

/** What it takes to raise a point: the agent's (or comment's) content plus where it came from. */
export type RaisedPoint = NewPoint &
  Pick<PointState, 'origin' | 'jobId' | 'githubCommentId' | 'githubThreadRootId' | 'commitSha' | 'trusted'> & {
    raisedBy: { githubId: string; login: string };
  };

export function raisePoint(ctx: Ctx, input: RaisedPoint): PointState {
  const { raisedBy, ...fields } = input;
  const pt: PointState = {
    ...fields,
    raisedBy: raisedBy.githubId,
    number: nextPointNumber(ctx.chat),
    status: 'open',
    authorResolution: null,
    escalationReason: null,
    round: ctx.chat.round,
  };
  ctx.chat.points.push(pt);
  say(ctx, {
    kind: 'point_raised',
    author: raisedBy,
    pointNumber: pt.number,
    jobId: pt.jobId,
    body: pt.title,
    data: { severity: pt.severity, category: pt.category, path: pt.path, line: pt.line },
  });
  // Some categories (security by default) always go to a person, and agents never touch them.
  if (ctx.rules.always_escalate.includes(pt.category)) escalatePoints(ctx, [pt], 'category');
  return pt;
}

/** Hand points to humans. Both sides are told right away (spec §9.3). */
export function escalatePoints(ctx: Ctx, points: PointState[], reason: EscalationReason): void {
  if (points.length === 0) return;
  for (const pt of points) {
    pt.status = 'escalated';
    pt.escalationReason = reason;
  }
  const verb = points.length === 1 ? 'needs' : 'need';
  system(ctx, `${pointList(points)} ${verb} a human decision: ${REASON_TEXT[reason]}`, {
    points: points.map((p) => p.number),
    reason,
  });
  const people = new Set([ctx.chat.authorGithubId, ...points.map((p) => p.raisedBy)]);
  const userIds = ctx.chat.participants.filter((p) => people.has(p.githubId) && onNitpilot(p)).map((p) => p.userId!);
  if (userIds.length > 0) {
    emit(ctx, { type: 'notify', userIds: [...new Set(userIds)], kind: 'escalated', pointNumbers: points.map((p) => p.number) });
  }
}
```

- [x] **Step 6: Write `advance.ts`**

`apps/server/src/engine/advance.ts`:
```ts
import { emit, system, type Ctx } from './context';
import { enqueueJob } from './jobs';
import { escalatePoints } from './points';
import { activeJobs, author, isActionable, onNitpilot, reviewers } from './state';

/**
 * What happens next (spec §9.3 "When reviews settle"). Safe to call at any time: while a
 * job is still active it only sets the phase.
 */
export function advance(ctx: Ctx): void {
  const chat = ctx.chat;
  if (chat.phase === 'closed' || chat.isDraft) return;

  const active = activeJobs(chat);
  if (active.some((j) => j.jobType !== 'address')) {
    chat.phase = 'reviewing';
    return;
  }
  if (active.some((j) => j.jobType === 'address')) {
    chat.phase = 'addressing';
    return;
  }

  // Nothing has been reviewed yet, so there's nothing to approve.
  const reviewedOnce = chat.points.length > 0 || reviewers(chat).some((r) => r.lastReviewedSha !== null);
  if (!reviewedOnce) {
    chat.phase = 'idle';
    return;
  }

  const actionable = chat.points.filter(isActionable);
  if (actionable.length === 0) {
    // Answered GitHub points wait for their human reviewer.
    if (chat.points.some((p) => p.status === 'addressed')) {
      chat.phase = 'reviewing';
      return;
    }
    if (chat.points.some((p) => p.status === 'escalated')) {
      enterEscalated(ctx);
      return;
    }
    enterReady(ctx);
    return;
  }

  const a = author(chat);
  if (!a || !onNitpilot(a)) {
    chat.phase = 'addressing'; // the human author's turn
    return;
  }
  if (chat.addressPasses >= ctx.rules.max_rounds) {
    const stuck = chat.points.filter((p) => p.trusted && (p.status === 'open' || p.status === 'addressed'));
    escalatePoints(ctx, stuck, 'round_limit');
    enterEscalated(ctx);
    return;
  }
  if (enqueueJob(ctx, a, 'address', null)) {
    const n = actionable.length;
    system(ctx, `${a.login}'s agent is working on ${n} point${n === 1 ? '' : 's'}`);
  }
  chat.phase = 'addressing';
}

function enterReady(ctx: Ctx): void {
  const chat = ctx.chat;
  if (chat.phase === 'ready') return;
  chat.phase = 'ready';
  system(ctx, 'Ready for approval');
  const userIds = reviewers(chat).filter((r) => r.requested && onNitpilot(r)).map((r) => r.userId!);
  if (userIds.length > 0) emit(ctx, { type: 'notify', userIds, kind: 'ready', pointNumbers: [] });
}

function enterEscalated(ctx: Ctx): void {
  if (ctx.chat.phase === 'escalated') return;
  ctx.chat.phase = 'escalated';
  // Everyone involved was already notified when each point escalated (points.ts).
  system(ctx, 'Waiting for a human decision');
}
```

- [x] **Step 7: Write `lifecycle.ts`**

`apps/server/src/engine/lifecycle.ts`:
```ts
import { advance } from './advance';
import { say, system, type Ctx, type Ev } from './context';
import { cancelJobs, startReview } from './jobs';
import { activeJobFor, activeJobs, ensureParticipant, pointList, reviewers, who } from './state';

export function onPrOpened(ctx: Ctx, e: Ev<'pr_opened'>): void {
  ensureParticipant(ctx.chat, e.author, 'author');
  const requested = e.reviewers.map((person) => {
    const r = ensureParticipant(ctx.chat, person, 'reviewer');
    r.requested = true;
    return r;
  });
  system(ctx, `Pull request opened by ${e.author.login}`);
  for (const r of requested) startReview(ctx, r);
}

export function onPrReady(ctx: Ctx): void {
  ctx.chat.isDraft = false;
  system(ctx, 'Marked ready for review');
  startReviewsOrAdvance(ctx);
}

export function onPrToDraft(ctx: Ctx): void {
  ctx.chat.isDraft = true;
  cancelJobs(ctx, activeJobs(ctx.chat), 'pr_to_draft');
  ctx.chat.phase = 'idle';
  system(ctx, 'Converted to draft: agents paused');
}

export function onPrClosed(ctx: Ctx, e: Ev<'pr_closed'>): void {
  const chat = ctx.chat;
  chat.closed = true;
  chat.merged = e.merged;
  chat.phase = 'closed';
  cancelJobs(ctx, activeJobs(chat), 'pr_closed');
  system(ctx, e.merged ? 'Merged' : 'Closed without merging');
}

export function onPrReopened(ctx: Ctx): void {
  ctx.chat.closed = false;
  ctx.chat.merged = false;
  ctx.chat.phase = 'idle';
  system(ctx, 'Reopened');
  startReviewsOrAdvance(ctx);
}

export function onReviewRequested(ctx: Ctx, e: Ev<'review_requested'>): void {
  const r = ensureParticipant(ctx.chat, e.reviewer, 'reviewer');
  r.requested = true;
  system(ctx, `Review requested from ${r.login}`);
  startReview(ctx, r);
}

export function onReviewRequestRemoved(ctx: Ctx, e: Ev<'review_request_removed'>): void {
  const chat = ctx.chat;
  const r = ensureParticipant(chat, e.reviewer, 'reviewer');
  r.requested = false;
  const job = activeJobFor(chat, r);
  if (job) cancelJobs(ctx, [job], 'reviewer_removed');
  // Their unresolved agent points are withdrawn (spec §9.2).
  const withdrawn = chat.points.filter((p) => p.raisedBy === r.githubId && p.origin === 'agent' && p.status !== 'resolved');
  for (const p of withdrawn) p.status = 'resolved';
  const suffix = withdrawn.length > 0 ? `; ${pointList(withdrawn)} withdrawn` : '';
  system(ctx, `${r.login} is no longer a reviewer${suffix}`);
  advance(ctx);
}

export function onManualReview(ctx: Ctx, e: Ev<'manual_review'>): void {
  const r = ensureParticipant(ctx.chat, e.reviewer, 'reviewer');
  r.requested = true;
  startReview(ctx, r, { manual: true });
}

export function onHumanNote(ctx: Ctx, e: Ev<'human_note'>): void {
  // Notes go into the agents' next job bundle; they don't change the workflow.
  say(ctx, { kind: 'human', author: who(e.author), body: e.body });
}

function startReviewsOrAdvance(ctx: Ctx): void {
  // map() first so every reviewer gets a chance, then check whether any review started.
  const started = reviewers(ctx.chat).map((r) => startReview(ctx, r)).some(Boolean);
  if (!started) advance(ctx);
}
```

- [x] **Step 8: Write `decide.ts`**

`apps/server/src/engine/decide.ts`:
```ts
import { emit, type Ctx } from './context';
import {
  onHumanNote, onManualReview, onPrClosed, onPrOpened, onPrReady, onPrReopened, onPrToDraft,
  onReviewRequestRemoved, onReviewRequested,
} from './lifecycle';
import { author, onNitpilot } from './state';
import type { DecideInput, DecideOutput } from './types';

/**
 * The workflow rules, as one pure function (spec §9): (state, event) → (state, timeline, commands).
 * See docs/why/pure-engine.md.
 */
export function decide(input: DecideInput): DecideOutput {
  const ctx: Ctx = {
    chat: structuredClone(input.chat),
    rules: input.rules,
    now: input.now,
    timeline: [],
    commands: [],
  };
  const event = input.event;

  switch (event.type) {
    case 'pr_opened': onPrOpened(ctx, event); break;
    case 'pr_ready': onPrReady(ctx); break;
    case 'pr_to_draft': onPrToDraft(ctx); break;
    case 'pr_closed': onPrClosed(ctx, event); break;
    case 'pr_reopened': onPrReopened(ctx); break;
    case 'review_requested': onReviewRequested(ctx, event); break;
    case 'review_request_removed': onReviewRequestRemoved(ctx, event); break;
    case 'manual_review': onManualReview(ctx, event); break;
    case 'human_note': onHumanNote(ctx, event); break;
    // Tasks 8–10 add the remaining event types and make this switch exhaustive.
    default: break;
  }

  finalize(ctx);
  return { chat: ctx.chat, timeline: ctx.timeline, commands: ctx.commands };
}

function finalize(ctx: Ctx): void {
  refreshAttention(ctx);
  if (ctx.timeline.length > 0 && hasAgentToAgentPoints(ctx)) emit(ctx, { type: 'upsert_summary' });
}

/** "Needs you" for escalations: the author and whoever raised an escalated point. */
function refreshAttention(ctx: Ctx): void {
  const chat = ctx.chat;
  const escalated = chat.points.filter((p) => p.status === 'escalated');
  const needed = new Set(escalated.length > 0 ? [chat.authorGithubId, ...escalated.map((p) => p.raisedBy)] : []);
  for (const p of chat.participants) {
    if (needed.has(p.githubId) && onNitpilot(p)) {
      if (p.attention === 'none') p.attention = 'decision';
    } else if (p.attention === 'decision') {
      p.attention = 'none';
    }
  }
}

/** The summary comment only exists in agent-to-agent mode (spec §15). */
function hasAgentToAgentPoints(ctx: Ctx): boolean {
  const a = author(ctx.chat);
  return !!a && onNitpilot(a) && ctx.chat.points.some((p) => p.origin === 'agent');
}
```

- [x] **Step 9: Run the tests to see them pass**

Run: `npm run test -w apps/server -- src/engine && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (all lifecycle tests), with no type or lint errors.

- [x] **Step 10: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): PR lifecycle, reviewer events and the advance rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Job results and the point state machine

**Files:**
- Create: `apps/server/src/engine/results.ts`, `apps/server/src/engine/results.test.ts`
- Modify: `apps/server/src/engine/points.ts` (add `applyDecision`, `applyReply`), `apps/server/src/engine/decide.ts` (add the `job_completed` case)

**Interfaces:**
- Consumes: `jobs.ts`, `points.ts`, `advance.ts`, `state.ts`.
- Produces: `onJobCompleted(ctx, e)`, `applyDecision(ctx, reviewer, decision, jobId): boolean`, `applyReply(ctx, author, reply, jobId, commit): boolean`.

Rules covered:
- **§6.1** single-player reviewer: one GitHub review.
- **§6.2** steps 3–5.
- **§9.2** every point transition caused by agents.
- **§9.3** settle outcomes: ready, escalated, the human author's turn, an address job, the round limit.
- Drafts.
- Ignoring stale results.

- [x] **Step 1: Write the failing tests**

`apps/server/src/engine/results.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  agentToAgent, commandsOf, jobOf, leo, maya, newPoint, participantOf, pointOf, result, run, sam,
} from './test-builders';
import type { ChatState } from './types';

/** leo's review job is running. */
function reviewing(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review')], ...over });
}

/** leo raised P1 and P2 in round 1; maya's address job is running. */
function addressing(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({
    phase: 'addressing',
    participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    points: [pointOf(1, leo), pointOf(2, leo, { severity: 'nit' })],
    jobs: [jobOf('job-a1', maya, 'author', 'address')],
    ...over,
  });
}

/** maya answered P1 (fixed) and P2 (declined); leo's re-review is running. */
function reReviewing(over: Partial<ChatState> = {}): ChatState {
  return agentToAgent({
    phase: 'reviewing',
    round: 2,
    addressPasses: 1,
    headSha: 'head2',
    participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    points: [
      pointOf(1, leo, { status: 'addressed', authorResolution: 'fixed' }),
      pointOf(2, leo, { status: 'addressed', authorResolution: 'declined' }),
    ],
    jobs: [jobOf('job-rr2', leo, 'reviewer', 're_review', { round: 2, headSha: 'head2' })],
    ...over,
  });
}

describe('review results (agent-to-agent)', () => {
  it("raises points and queues the author's address job", () => {
    const out = run(reviewing(), { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint(), newPoint({ severity: 'nit', title: 'Rename' })] }) });
    expect(out.chat.points.map((p) => [p.number, p.status, p.raisedBy, p.commitSha])).toEqual([
      [1, 'open', leo.githubId, 'head1'],
      [2, 'open', leo.githubId, 'head1'],
    ]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.lastReviewedSha).toBe('head1');
    expect(out.chat.phase).toBe('addressing');
    expect(commandsOf(out, 'complete_job')[0]).toMatchObject({ jobId: 'job-r1', applyState: 'applied' });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address', round: 1, sinceSha: null, applyState: 'pending' },
    ]);
    expect(commandsOf(out, 'post_review')).toEqual([]);
    expect(commandsOf(out, 'upsert_summary')).toHaveLength(1);
  });

  it('escalates a security point at once, notifies both sides, and keeps working on the rest', () => {
    const out = run(reviewing(), { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint({ category: 'security' }), newPoint()] }) });
    expect(out.chat.points[0]).toMatchObject({ status: 'escalated', escalationReason: 'category' });
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-maya', 'user-leo'], kind: 'escalated', pointNumbers: [1] }]);
    expect(commandsOf(out, 'enqueue_job')[0]!.jobType).toBe('address');
    expect(out.chat.participants.every((p) => p.attention === 'decision')).toBe(true);
  });

  it('caps the points from one review at max_points_per_review', () => {
    const out = run(reviewing(), { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint(), newPoint(), newPoint()] }) }, { rules: { max_points_per_review: 2 } });
    expect(out.chat.points).toHaveLength(2);
  });

  it('goes straight to ready when the review finds nothing', () => {
    const out = run(reviewing(), { type: 'job_completed', jobId: 'job-r1', result: result() });
    expect(out.chat.phase).toBe('ready');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'ready', pointNumbers: [] }]);
  });
});

describe('address results', () => {
  it('marks answers, bumps the round and queues a re-review from the last reviewed commit', () => {
    const out = run(addressing(), {
      type: 'job_completed',
      jobId: 'job-a1',
      result: result({
        replies: [
          { point: 1, resolution: 'fixed', comment: 'Added the empty check.' },
          { point: 2, resolution: 'declined', comment: 'Kept for API compatibility.' },
        ],
        push: { from: 'head1aaa', to: 'head2bbb' },
      }),
    });
    expect(out.chat.points.map((p) => [p.number, p.status, p.authorResolution])).toEqual([
      [1, 'addressed', 'fixed'],
      [2, 'addressed', 'declined'],
    ]);
    expect(out.chat).toMatchObject({ round: 2, addressPasses: 1, phase: 'reviewing' });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: leo.githubId, role: 'reviewer' }, jobType: 're_review', round: 2, sinceSha: 'head1', applyState: 'pending' },
    ]);
    expect(commandsOf(out, 'post_thread_replies')).toEqual([]);
  });

  it('answers a GitHub point in its GitHub thread', () => {
    const chat = agentToAgent({
      phase: 'addressing',
      participants: [participantOf(maya, 'author'), participantOf(sam, 'reviewer', { requested: false })],
      points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001', githubThreadRootId: '9001', jobId: null })],
      jobs: [jobOf('job-a1', maya, 'author', 'address')],
    });
    const out = run(chat, {
      type: 'job_completed',
      jobId: 'job-a1',
      result: result({ replies: [{ point: 1, resolution: 'fixed', comment: 'Added the check.' }], push: { from: 'head1aaa', to: 'c0ffee1234' } }),
    });
    expect(commandsOf(out, 'post_thread_replies')).toEqual([
      { type: 'post_thread_replies', asGithubId: maya.githubId, replies: [{ pointNumber: 1, body: 'Added the check.\n\nFixed in c0ffee1.' }] },
    ]);
    // sam isn't on Nitpilot: his GitHub point now waits for him.
    expect(out.chat.phase).toBe('reviewing');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('ignores replies to points that are not open', () => {
    const chat = addressing({ points: [pointOf(1, leo, { status: 'escalated', escalationReason: 'category' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-a1', result: result({ replies: [{ point: 1, resolution: 'fixed', comment: 'x' }] }) });
    expect(out.chat.points[0]!.status).toBe('escalated');
  });
});

describe('re-review results', () => {
  it('becomes ready when every point is resolved, and tells only the reviewer', () => {
    const out = run(reReviewing(), {
      type: 'job_completed',
      jobId: 'job-rr2',
      result: result({ decisions: [{ point: 1, decision: 'resolve', comment: 'Looks right.' }, { point: 2, decision: 'resolve', comment: 'Fair.' }] }),
    });
    expect(out.chat.phase).toBe('ready');
    expect(out.chat.participants.find((p) => p.login === 'leo')!.lastReviewedSha).toBe('head2');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'ready', pointNumbers: [] }]);
  });

  it('escalates a declined point that the reviewer keeps open (a disagreement)', () => {
    const out = run(reReviewing(), {
      type: 'job_completed',
      jobId: 'job-rr2',
      result: result({ decisions: [{ point: 1, decision: 'resolve', comment: 'ok' }, { point: 2, decision: 'keep_open', comment: 'Still needed.' }] }),
    });
    expect(out.chat.points[1]).toMatchObject({ status: 'escalated', escalationReason: 'disagreement' });
    expect(out.chat.phase).toBe('escalated');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-maya', 'user-leo'], kind: 'escalated', pointNumbers: [2] }]);
  });

  it('reopens a fixed point the reviewer keeps open, and starts another address pass', () => {
    const out = run(reReviewing(), {
      type: 'job_completed',
      jobId: 'job-rr2',
      result: result({ decisions: [{ point: 1, decision: 'keep_open', comment: 'Still crashes on null.' }, { point: 2, decision: 'resolve', comment: 'ok' }] }),
    });
    expect(out.chat.points[0]!.status).toBe('open');
    expect(out.chat.phase).toBe('addressing');
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 'address', round: 2 });
  });

  it('escalates every open point when the round limit is reached', () => {
    const out = run(reReviewing({ addressPasses: 3, round: 4 }), {
      type: 'job_completed',
      jobId: 'job-rr2',
      result: result({ decisions: [{ point: 1, decision: 'keep_open', comment: 'no' }, { point: 2, decision: 'resolve', comment: 'ok' }] }),
    });
    expect(out.chat.points[0]).toMatchObject({ status: 'escalated', escalationReason: 'round_limit' });
    expect(out.chat.phase).toBe('escalated');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it("ignores decisions about another reviewer's points", () => {
    const chat = reReviewing({ points: [pointOf(1, sam, { status: 'addressed', authorResolution: 'fixed' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-rr2', result: result({ decisions: [{ point: 1, decision: 'resolve', comment: 'mine now' }] }) });
    expect(out.chat.points[0]!.status).toBe('addressed');
  });
});

describe('single-player reviewer (the author is not on Nitpilot)', () => {
  const offAuthor = { ...maya, userId: null };

  it('posts the points as one GitHub review and hands the turn to the human author', () => {
    const chat = reviewing({ participants: [participantOf(offAuthor, 'author'), participantOf(leo, 'reviewer')] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint()] }) });
    expect(commandsOf(out, 'post_review')).toEqual([{ type: 'post_review', reviewerGithubId: leo.githubId, pointNumbers: [1] }]);
    expect(out.chat.phase).toBe('addressing');
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
    expect(commandsOf(out, 'upsert_summary')).toEqual([]);
  });

  it('answers re-review decisions in the GitHub threads of the posted points', () => {
    const chat = reReviewing({
      participants: [participantOf(offAuthor, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
      points: [pointOf(1, leo, { status: 'addressed', authorResolution: 'answered', githubCommentId: '77', githubThreadRootId: '77' })],
    });
    const out = run(chat, { type: 'job_completed', jobId: 'job-rr2', result: result({ decisions: [{ point: 1, decision: 'resolve', comment: 'Thanks, that works.' }] }) });
    expect(commandsOf(out, 'post_thread_replies')).toEqual([
      { type: 'post_thread_replies', asGithubId: leo.githubId, replies: [{ pointNumber: 1, body: 'Thanks, that works.' }] },
    ]);
    expect(out.chat.phase).toBe('ready');
  });
});

describe('drafts and stale results', () => {
  it('keeps a draft-mode result as drafts and tells its owner', () => {
    const chat = reviewing({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { applyState: 'draft' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint()] }) });
    expect(commandsOf(out, 'complete_job')[0]).toMatchObject({ applyState: 'draft' });
    expect(out.chat.points).toEqual([]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('drafts');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'drafts', pointNumbers: [] }]);
  });

  it('ignores a result for a job that was cancelled', () => {
    const chat = reviewing({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { status: 'cancelled' })] });
    const out = run(chat, { type: 'job_completed', jobId: 'job-r1', result: result({ points: [newPoint()] }) });
    expect(out.commands).toEqual([]);
    expect(out.timeline).toEqual([]);
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm run test -w apps/server -- src/engine/results.test.ts`
Expected: FAIL. The first assertion on `out.chat.points` gets `[]`, because `job_completed` hits `default` in `decide`.

- [x] **Step 3: Add `applyDecision` and `applyReply` to `points.ts`**

Add these imports to the top of `apps/server/src/engine/points.ts` (merge with the existing ones):
```ts
import type { PointDecision, PointReply } from '@nitpilot/protocol';
import { pointByNumber, who } from './state';
import type { ParticipantState } from './types';
```

Append:
```ts
/**
 * A reviewer agent's verdict on one of its own points (spec §9.2). Returns false when the
 * decision doesn't apply (someone else's point, or one that is escalated or resolved).
 */
export function applyDecision(ctx: Ctx, reviewer: ParticipantState, d: PointDecision, jobId: string): boolean {
  const pt = pointByNumber(ctx.chat, d.point);
  if (!pt || pt.raisedBy !== reviewer.githubId || pt.origin !== 'agent') return false;
  if (pt.status === 'escalated' || pt.status === 'resolved') return false;

  say(ctx, { kind: 'point_decision', author: who(reviewer), pointNumber: pt.number, jobId, body: d.comment, data: { decision: d.decision } });
  if (d.decision === 'resolve') {
    pt.status = 'resolved';
  } else if (pt.status === 'addressed' && pt.authorResolution === 'declined') {
    escalatePoints(ctx, [pt], 'disagreement'); // fires immediately (spec §9.2)
  } else {
    pt.status = 'open';
  }
  return true;
}

/** The author agent's answer to an open point. Returns false when the point isn't open. */
export function applyReply(ctx: Ctx, authorP: ParticipantState, r: PointReply, jobId: string, commit: string | null): boolean {
  const pt = pointByNumber(ctx.chat, r.point);
  if (!pt || pt.status !== 'open' || !pt.trusted) return false;
  pt.status = 'addressed';
  pt.authorResolution = r.resolution;
  say(ctx, { kind: 'point_reply', author: who(authorP), pointNumber: pt.number, jobId, body: r.comment, data: { resolution: r.resolution, commit } });
  return true;
}
```

- [x] **Step 4: Write `results.ts`**

`apps/server/src/engine/results.ts`:
```ts
import type { JobResult, PointReply, Severity } from '@nitpilot/protocol';
import { advance } from './advance';
import { emit, say, system, type Ctx, type Ev } from './context';
import { startReview } from './jobs';
import { applyDecision, applyReply, raisePoint } from './points';
import { author, onNitpilot, participant, pointByNumber, reviewers, who } from './state';
import type { JobView, ParticipantState } from './types';

export function onJobCompleted(ctx: Ctx, e: Ev<'job_completed'>): void {
  const chat = ctx.chat;
  const job = chat.jobs.find((j) => j.id === e.jobId);
  // A result for a job that was cancelled or already finished is stale: ignore it.
  if (!job || job.status !== 'running') return;
  job.status = 'done';
  const p = participant(chat, job.participantGithubId, job.role);

  if (job.applyState === 'draft') {
    emit(ctx, { type: 'complete_job', jobId: job.id, applyState: 'draft', result: e.result });
    if (p) {
      p.attention = 'drafts';
      if (p.userId) emit(ctx, { type: 'notify', userIds: [p.userId], kind: 'drafts', pointNumbers: [] });
      system(ctx, `${p.login}'s agent finished; its work waits as drafts`, { jobId: job.id });
    }
    return;
  }

  emit(ctx, { type: 'complete_job', jobId: job.id, applyState: 'applied', result: e.result });
  if (!p) return;
  if (job.jobType === 'address') applyAddress(ctx, job, p, e.result);
  else applyReview(ctx, job, p, e.result);
  advance(ctx);
}

function applyReview(ctx: Ctx, job: JobView, reviewer: ParticipantState, result: JobResult): void {
  const chat = ctx.chat;
  say(ctx, { kind: 'job_summary', author: who(reviewer), jobId: job.id, body: result.summary, data: { jobType: job.jobType, counts: severityCounts(result) } });

  const raised = result.points.slice(0, ctx.rules.max_points_per_review).map((np) =>
    raisePoint(ctx, {
      ...np,
      raisedBy: who(reviewer),
      origin: 'agent',
      jobId: job.id,
      githubCommentId: null,
      githubThreadRootId: null,
      commitSha: job.headSha,
      trusted: true,
    }),
  );
  const decided = result.decisions.filter((d) => applyDecision(ctx, reviewer, d, job.id));
  reviewer.lastReviewedSha = job.headSha;

  // Single-player reviewer: the author isn't on Nitpilot, so answer on GitHub (spec §6.1).
  const a = author(chat);
  if (a && onNitpilot(a)) return;
  if (raised.length > 0) {
    emit(ctx, { type: 'post_review', reviewerGithubId: reviewer.githubId, pointNumbers: raised.map((p) => p.number) });
  }
  const onGithub = decided.filter((d) => pointByNumber(chat, d.point)?.githubThreadRootId);
  if (onGithub.length > 0) {
    emit(ctx, { type: 'post_thread_replies', asGithubId: reviewer.githubId, replies: onGithub.map((d) => ({ pointNumber: d.point, body: d.comment })) });
  }
}

function applyAddress(ctx: Ctx, job: JobView, authorP: ParticipantState, result: JobResult): void {
  const chat = ctx.chat;
  const commit = result.push?.to ?? null;
  say(ctx, { kind: 'job_summary', author: who(authorP), jobId: job.id, body: result.summary, data: { jobType: 'address', push: result.push } });
  if (commit) system(ctx, `${authorP.login}'s agent pushed ${commit.slice(0, 7)}`, { commit });

  const replied = result.replies.filter((r) => applyReply(ctx, authorP, r, job.id, commit));
  chat.addressPasses += 1;
  chat.round += 1;

  // A point that lives on GitHub is answered in its GitHub thread (spec §6.1).
  const onGithub = replied.filter((r) => pointByNumber(chat, r.point)?.githubThreadRootId);
  if (onGithub.length > 0) {
    emit(ctx, {
      type: 'post_thread_replies',
      asGithubId: authorP.githubId,
      replies: onGithub.map((r) => ({ pointNumber: r.point, body: replyBody(r, commit) })),
    });
  }

  // Reviewers with answered points re-review; requested reviewers who never reviewed start now.
  for (const r of reviewers(chat)) {
    const waiting = chat.points.some((p) => p.raisedBy === r.githubId && p.origin === 'agent' && p.status === 'addressed');
    if (waiting || r.lastReviewedSha === null) startReview(ctx, r);
  }
}

function replyBody(r: PointReply, commit: string | null): string {
  return r.resolution === 'fixed' && commit ? `${r.comment}\n\nFixed in ${commit.slice(0, 7)}.` : r.comment;
}

function severityCounts(result: JobResult): Partial<Record<Severity, number>> {
  const counts: Partial<Record<Severity, number>> = {};
  for (const p of result.points) counts[p.severity] = (counts[p.severity] ?? 0) + 1;
  return counts;
}
```

- [x] **Step 5: Route `job_completed` in `decide.ts`**

In `apps/server/src/engine/decide.ts`, add the import and the case before `default`:
```ts
import { onJobCompleted } from './results';
```
```ts
    case 'job_completed': onJobCompleted(ctx, event); break;
```

- [x] **Step 6: Run the tests to see them pass**

Run: `npm run test -w apps/server -- src/engine && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (results and lifecycle), with no type or lint errors.

- [x] **Step 7: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): job results, point state machine and settle rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: External activity (GitHub comments, reviews, threads, pushes, timers)

**Files:**
- Create: `apps/server/src/engine/external.ts`, `apps/server/src/engine/external.test.ts`
- Modify: `apps/server/src/engine/decide.ts` (add 7 cases)

**Interfaces:**
- Consumes: `advance`, `jobs.ts`, `points.ts`, `state.ts`.
- Produces: `onExternalComment`, `onCommentDeleted`, `onReviewSubmitted`, `onThreadResolved`, `onThreadUnresolved`, `onHeadUpdated` and `onTimer`, plus the timer keys `COMMENTS_TIMER = 'comments'` and `syncTimer(githubId) = 'sync:<githubId>'`.

Rules covered:
- **§6.1:** single-player author mode, where trusted GitHub comments become points; untrusted comments never trigger work.
- **§9.2:** GitHub-point transitions (thread resolved, comment deleted, the reviewer replies after an answer).
- **§15:** debounce for loose comments while submitted reviews act at once; single-player reviewer re-review on push or author reply; approval stops agent rounds; bot ping-pong capped by `max_rounds`.
- **Review Focus #3/#4:** duplicates, late timers, and a human push mid-address.

- [x] **Step 1: Write the failing tests**

`apps/server/src/engine/external.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  T0, agentToAgent, chatState, commandsOf, jobOf, leo, maya, participantOf, pointOf, rabbit, result, run, sam,
} from './test-builders';
import type { ChatState, ExternalComment, Person } from './types';

function comment(id: string, author: Person, over: Partial<ExternalComment> = {}): ExternalComment {
  return { id, threadRootId: null, author, trusted: true, body: 'Please handle the empty list.', path: 'src/orders/list.ts', line: 48, side: 'RIGHT', commitSha: 'head1', ...over };
}

/** Single-player author: maya is on Nitpilot, nobody reviewing is. */
function soloAuthor(over: Partial<ChatState> = {}): ChatState {
  return chatState({ participants: [participantOf(maya, 'author')], ...over });
}

const at30s = new Date(T0.getTime() + 30_000);

describe('loose GitHub comments (single-player author)', () => {
  it('turn a trusted comment into a point and wait for quiet before working', () => {
    const out = run(soloAuthor(), { type: 'external_comment', comment: comment('9001', sam) });
    expect(out.chat.points[0]).toMatchObject({ number: 1, origin: 'github', githubCommentId: '9001', githubThreadRootId: '9001', raisedBy: sam.githubId, status: 'open' });
    expect(commandsOf(out, 'schedule')).toEqual([{ type: 'schedule', key: 'comments', at: at30s }]);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it("start the author's agent when the debounce timer fires", () => {
    const chat = soloAuthor({ points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001' })] });
    const out = run(chat, { type: 'timer', key: 'comments' });
    expect(commandsOf(out, 'enqueue_job')).toEqual([
      { type: 'enqueue_job', participant: { githubId: maya.githubId, role: 'author' }, jobType: 'address', round: 1, sinceSha: null, applyState: 'pending' },
    ]);
    expect(out.chat.phase).toBe('addressing');
  });

  it('ignore a comment it has already seen', () => {
    const chat = soloAuthor({ points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001' })] });
    const out = run(chat, { type: 'external_comment', comment: comment('9001', sam) });
    expect(out.chat.points).toHaveLength(1);
    expect(out.commands).toEqual([]);
  });

  it('record an untrusted comment without triggering any work', () => {
    const out = run(soloAuthor(), { type: 'external_comment', comment: comment('9002', sam, { trusted: false }) });
    expect(out.chat.points[0]!.trusted).toBe(false);
    expect(commandsOf(out, 'schedule')).toEqual([]);
  });

  it("treat the author's own top-level comment as a message, not a point", () => {
    const out = run(soloAuthor(), { type: 'external_comment', comment: comment('9003', maya) });
    expect(out.chat.points).toEqual([]);
    expect(out.timeline[0]!.kind).toBe('human');
  });
});

describe('submitted reviews', () => {
  it('act at once for changes_requested and cancel the debounce', () => {
    const out = run(soloAuthor(), {
      type: 'external_review_submitted',
      review: { id: 'r1', author: sam, trusted: true, state: 'changes_requested', body: '', comments: [comment('9001', sam), comment('9002', sam)] },
    });
    expect(out.chat.points).toHaveLength(2);
    expect(commandsOf(out, 'unschedule')).toEqual([{ type: 'unschedule', key: 'comments' }]);
    expect(commandsOf(out, 'enqueue_job')[0]!.jobType).toBe('address');
  });

  it('treat a single loose comment (commented, empty body) like a loose comment', () => {
    const out = run(soloAuthor(), {
      type: 'external_review_submitted',
      review: { id: 'r2', author: sam, trusted: true, state: 'commented', body: '', comments: [comment('9001', sam)] },
    });
    expect(commandsOf(out, 'schedule')).toHaveLength(1);
    expect(commandsOf(out, 'enqueue_job')).toEqual([]);
  });

  it('do not duplicate comments that arrived before the review event', () => {
    const chat = soloAuthor({ points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001' })] });
    const out = run(chat, {
      type: 'external_review_submitted',
      review: { id: 'r1', author: sam, trusted: true, state: 'changes_requested', body: '', comments: [comment('9001', sam)] },
    });
    expect(out.chat.points).toHaveLength(1);
  });

  it('turn a non-empty review body into a point', () => {
    const out = run(soloAuthor(), {
      type: 'external_review_submitted',
      review: { id: 'r3', author: sam, trusted: true, state: 'changes_requested', body: 'Needs tests overall.', comments: [] },
    });
    expect(out.chat.points[0]).toMatchObject({ githubCommentId: 'review:r3', path: null, title: 'Needs tests overall.' });
  });

  it("stop agent rounds for a reviewer who approves, resolving their points", () => {
    const chat = agentToAgent({ phase: 'reviewing', points: [pointOf(1, leo, { status: 'addressed', authorResolution: 'fixed' })], jobs: [jobOf('job-rr', leo, 'reviewer', 're_review')] });
    const out = run(chat, { type: 'external_review_submitted', review: { id: 'r4', author: leo, trusted: true, state: 'approved', body: '', comments: [] } });
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-rr'], reason: 'approved' }]);
    expect(out.chat.points[0]!.status).toBe('resolved');
    expect(out.chat.participants.find((p) => p.login === 'leo')!.requested).toBe(false);
    expect(out.chat.phase).toBe('ready');
  });
});

describe('threads', () => {
  const answered = () => soloAuthor({
    phase: 'reviewing',
    participants: [participantOf(maya, 'author'), participantOf(sam, 'reviewer', { requested: false })],
    points: [pointOf(1, sam, { origin: 'github', githubCommentId: '9001', githubThreadRootId: '9001', status: 'addressed', authorResolution: 'fixed' })],
  });

  it('resolve a GitHub point when its thread is resolved, then settle', () => {
    const out = run(answered(), { type: 'thread_resolved', threadRootId: '9001' });
    expect(out.chat.points[0]!.status).toBe('resolved');
    expect(out.chat.phase).toBe('ready');
  });

  it('reopen an answered GitHub point when its reviewer replies', () => {
    const out = run(answered(), { type: 'external_comment', comment: comment('9010', sam, { threadRootId: '9001', body: 'Still broken for null.' }) });
    expect(out.chat.points[0]!.status).toBe('open');
    expect(commandsOf(out, 'schedule')).toHaveLength(1);
  });

  it('resolve a GitHub point whose comment was deleted', () => {
    const out = run(answered(), { type: 'external_comment_deleted', commentId: '9001' });
    expect(out.chat.points[0]!.status).toBe('resolved');
  });

  it('reopen a resolved GitHub point when its thread is unresolved', () => {
    const chat = answered();
    chat.points[0]!.status = 'resolved';
    const out = run(chat, { type: 'thread_unresolved', threadRootId: '9001' });
    expect(out.chat.points[0]!.status).toBe('open');
  });
});

describe('single-player reviewer (author not on Nitpilot)', () => {
  const offAuthor = { ...maya, userId: null };
  const humanTurn = () => agentToAgent({
    phase: 'addressing',
    participants: [participantOf(offAuthor, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })],
    points: [pointOf(1, leo, { githubCommentId: '77', githubThreadRootId: '77' })],
  });

  it("marks our agent's point answered when the author replies, and re-reviews after a quiet period", () => {
    const out = run(humanTurn(), { type: 'external_comment', comment: comment('78', offAuthor, { threadRootId: '77', body: 'It is guarded upstream.' }) });
    expect(out.chat.points[0]).toMatchObject({ status: 'addressed', authorResolution: 'answered' });
    expect(commandsOf(out, 'schedule')).toEqual([{ type: 'schedule', key: `sync:${leo.githubId}`, at: at30s }]);

    const fired = run(out.chat, { type: 'timer', key: `sync:${leo.githubId}` });
    expect(commandsOf(fired, 'enqueue_job')[0]).toMatchObject({ jobType: 're_review', sinceSha: 'head1' });
  });

  it("schedules a re-review when the human author pushes", () => {
    const out = run(humanTurn(), { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    expect(out.chat.headSha).toBe('head2');
    expect(commandsOf(out, 'schedule')).toEqual([{ type: 'schedule', key: `sync:${leo.githubId}`, at: at30s }]);
  });
});

describe('pushes', () => {
  it('only records the new head for our own push', () => {
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-rr', leo, 'reviewer', 're_review')] });
    const out = run(chat, { type: 'head_updated', before: 'head1', after: 'head2', ours: true });
    expect(out.chat.headSha).toBe('head2');
    expect(out.commands).toEqual([]);
  });

  it("restarts the address pass when a human pushes during it", () => {
    const chat = agentToAgent({ phase: 'addressing', points: [pointOf(1, leo)], jobs: [jobOf('job-a1', maya, 'author', 'address')] });
    const out = run(chat, { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    expect(commandsOf(out, 'cancel_jobs')).toEqual([{ type: 'cancel_jobs', jobIds: ['job-a1'], reason: 'branch_moved' }]);
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 'address' });
  });

  it('re-reviews from the last reviewed commit when a human pushes to a ready PR', () => {
    const chat = agentToAgent({ phase: 'ready', participants: [participantOf(maya, 'author'), participantOf(leo, 'reviewer', { lastReviewedSha: 'head1' })] });
    const out = run(chat, { type: 'head_updated', before: 'head1', after: 'head2', ours: false });
    expect(out.chat.phase).toBe('reviewing');
    expect(commandsOf(out, 'enqueue_job')[0]).toMatchObject({ jobType: 're_review', sinceSha: 'head1' });
  });
});

describe('timers', () => {
  it('do nothing once the PR is closed', () => {
    const chat = soloAuthor({ phase: 'closed', closed: true, points: [pointOf(1, sam, { origin: 'github' })] });
    const out = run(chat, { type: 'timer', key: 'comments' });
    expect(out.commands).toEqual([]);
    expect(out.chat.phase).toBe('closed');
  });

  it('stop bot ping-pong at the round limit', () => {
    // coderabbit keeps commenting; maya's agent already did max_rounds passes.
    const chat = soloAuthor({ addressPasses: 3, round: 4 });
    const commented = run(chat, { type: 'external_comment', comment: comment('9100', rabbit) });
    const fired = run(commented.chat, { type: 'timer', key: 'comments' });
    expect(fired.chat.points[0]).toMatchObject({ status: 'escalated', escalationReason: 'round_limit' });
    expect(fired.chat.phase).toBe('escalated');
    expect(commandsOf(fired, 'enqueue_job')).toEqual([]);
  });
});

describe('results after external activity', () => {
  it('a job result still settles normally after a GitHub point was raised mid-review', () => {
    const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review')] });
    const commented = run(chat, { type: 'external_comment', comment: comment('9001', sam) });
    const done = run(commented.chat, { type: 'job_completed', jobId: 'job-r1', result: result() });
    // sam's GitHub point is actionable, so maya's agent works on it.
    expect(commandsOf(done, 'enqueue_job')[0]).toMatchObject({ jobType: 'address' });
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm run test -w apps/server -- src/engine/external.test.ts`
Expected: FAIL. `out.chat.points[0]` is `undefined`, because these events still hit `default`.

- [x] **Step 3: Write `external.ts`**

`apps/server/src/engine/external.ts`:
```ts
import { advance } from './advance';
import { addMs, emit, say, system, type Ctx, type Ev } from './context';
import { cancelJobs, enqueueJob, startReview } from './jobs';
import { raisePoint } from './points';
import {
  activeJobFor, activeJobs, author, ensureParticipant, onNitpilot, participant, pointByThread, reviewers, who,
} from './state';
import type { ExternalComment, Person } from './types';

export const COMMENTS_TIMER = 'comments';
export const syncTimer = (githubId: string): string => `sync:${githubId}`;

export function onExternalComment(ctx: Ctx, e: Ev<'external_comment'>): void {
  if (ctx.chat.phase === 'closed') return;
  if (handleComment(ctx, e.comment)) scheduleComments(ctx);
}

export function onCommentDeleted(ctx: Ctx, e: Ev<'external_comment_deleted'>): void {
  const pt = ctx.chat.points.find((p) => p.githubCommentId === e.commentId);
  if (!pt || pt.status === 'resolved') return;
  pt.status = 'resolved';
  system(ctx, `P${pt.number}'s comment was deleted on GitHub`);
  advance(ctx);
}

export function onReviewSubmitted(ctx: Ctx, e: Ev<'external_review_submitted'>): void {
  const chat = ctx.chat;
  if (chat.phase === 'closed') return;
  const review = e.review;
  const byAuthor = review.author.githubId === chat.authorGithubId;

  const raisedTrusted = review.comments.map((c) => handleComment(ctx, c)).some(Boolean);
  if (!byAuthor && review.state !== 'approved' && review.body.trim() && !chat.points.some((p) => p.githubCommentId === `review:${review.id}`)) {
    ensureParticipant(chat, review.author, 'reviewer');
    raisePoint(ctx, {
      ...githubPointContent(review.body, null, null, null),
      raisedBy: who(review.author),
      origin: 'github',
      jobId: null,
      githubCommentId: `review:${review.id}`,
      githubThreadRootId: `review:${review.id}`,
      commitSha: null,
      trusted: review.trusted,
    });
  }
  if (review.state === 'approved' && !byAuthor) approve(ctx, review.author);

  // GitHub's "Add single comment" arrives as a review with state `commented` and no body:
  // treat it like a loose comment and wait for quiet. Anything else acts at once (spec §15).
  const loose = review.state === 'commented' && !review.body.trim();
  if (loose) {
    if (raisedTrusted) scheduleComments(ctx);
    return;
  }
  emit(ctx, { type: 'unschedule', key: COMMENTS_TIMER });
  advance(ctx);
}

export function onThreadResolved(ctx: Ctx, e: Ev<'thread_resolved'>): void {
  const pt = pointByThread(ctx.chat, e.threadRootId);
  if (!pt || pt.status === 'resolved') return;
  pt.status = 'resolved';
  system(ctx, `P${pt.number} resolved on GitHub`);
  advance(ctx);
}

export function onThreadUnresolved(ctx: Ctx, e: Ev<'thread_unresolved'>): void {
  const pt = pointByThread(ctx.chat, e.threadRootId);
  if (!pt || pt.status !== 'resolved' || pt.origin !== 'github') return;
  pt.status = 'open';
  system(ctx, `P${pt.number} reopened on GitHub`);
  if (pt.trusted) scheduleComments(ctx);
}

export function onHeadUpdated(ctx: Ctx, e: Ev<'head_updated'>): void {
  const chat = ctx.chat;
  chat.headSha = e.after;
  // Our own push was announced with job.pushing; the address result handles it.
  if (e.ours || chat.phase === 'closed' || chat.isDraft) return;
  system(ctx, `New commits pushed (${e.after.slice(0, 7)})`, { before: e.before, after: e.after });

  const address = activeJobs(chat).find((j) => j.jobType === 'address');
  const a = author(chat);
  if (address && a) {
    // A human pushed while the author's agent was fixing: run that pass again on the new head.
    cancelJobs(ctx, [address], 'branch_moved');
    enqueueJob(ctx, a, 'address', null);
    return;
  }
  if (chat.phase === 'ready' || chat.phase === 'escalated') {
    for (const r of reviewers(chat)) if (r.lastReviewedSha) startReview(ctx, r);
    return;
  }
  if (chat.phase === 'addressing') {
    // The human author is working (they're not on Nitpilot): re-review once they stop pushing.
    for (const r of reviewers(chat)) {
      if (onNitpilot(r) && hasOpenAgentPoints(ctx, r.githubId)) {
        emit(ctx, { type: 'schedule', key: syncTimer(r.githubId), at: debounceAt(ctx) });
      }
    }
  }
}

export function onTimer(ctx: Ctx, e: Ev<'timer'>): void {
  const chat = ctx.chat;
  // A timer that fires after the PR closed (or went back to draft) does nothing.
  if (chat.phase === 'closed' || chat.isDraft) return;
  if (e.key === COMMENTS_TIMER) {
    advance(ctx);
    return;
  }
  if (e.key.startsWith('sync:')) {
    const r = participant(chat, e.key.slice('sync:'.length), 'reviewer');
    if (r && hasOpenAgentPoints(ctx, r.githubId)) startReview(ctx, r);
  }
}

/** Returns true when a new trusted, top-level point was raised (so the caller can debounce). */
function handleComment(ctx: Ctx, c: ExternalComment): boolean {
  const chat = ctx.chat;
  // Already seen: a redelivery, or the same comment through another event.
  if (chat.points.some((p) => p.githubCommentId === c.id)) return false;
  if (c.threadRootId) {
    handleReply(ctx, c);
    return false;
  }
  if (c.author.githubId === chat.authorGithubId) {
    say(ctx, { kind: 'human', author: who(c.author), body: c.body });
    return false;
  }
  ensureParticipant(chat, c.author, 'reviewer');
  raisePoint(ctx, {
    ...githubPointContent(c.body, c.path, c.line, c.side),
    raisedBy: who(c.author),
    origin: 'github',
    jobId: null,
    githubCommentId: c.id,
    githubThreadRootId: c.id,
    commitSha: c.commitSha,
    trusted: c.trusted,
  });
  return c.trusted;
}

function handleReply(ctx: Ctx, c: ExternalComment): void {
  const chat = ctx.chat;
  say(ctx, { kind: 'human', author: who(c.author), body: c.body, data: { threadRootId: c.threadRootId } });
  const pt = pointByThread(chat, c.threadRootId!);
  if (!pt) return;

  // The reviewer pushes back on an answered GitHub point: it's open again (spec §9.2).
  if (pt.origin === 'github' && pt.status === 'addressed' && c.author.githubId === pt.raisedBy) {
    pt.status = 'open';
    scheduleComments(ctx);
    return;
  }
  // The human author answered our reviewer agent's comment: re-review after a quiet period (spec §15).
  if (pt.origin === 'agent' && pt.status === 'open' && c.author.githubId === chat.authorGithubId) {
    pt.status = 'addressed';
    pt.authorResolution = 'answered';
    const r = participant(chat, pt.raisedBy, 'reviewer');
    if (r && onNitpilot(r)) emit(ctx, { type: 'schedule', key: syncTimer(r.githubId), at: debounceAt(ctx) });
  }
}

/** A reviewer approved on GitHub: their points are resolved and agent rounds stop for them (spec §6.3). */
function approve(ctx: Ctx, person: Person): void {
  const chat = ctx.chat;
  const r = ensureParticipant(chat, person, 'reviewer');
  r.requested = false;
  const job = activeJobFor(chat, r);
  if (job) cancelJobs(ctx, [job], 'approved');
  const remaining = chat.points.filter((p) => p.raisedBy === r.githubId && p.status !== 'resolved');
  for (const p of remaining) p.status = 'resolved';
  system(ctx, `${r.login} approved on GitHub`, { resolved: remaining.map((p) => p.number) });
}

function hasOpenAgentPoints(ctx: Ctx, reviewerGithubId: string): boolean {
  return ctx.chat.points.some((p) => p.raisedBy === reviewerGithubId && p.origin === 'agent' && (p.status === 'open' || p.status === 'addressed'));
}

function scheduleComments(ctx: Ctx): void {
  emit(ctx, { type: 'schedule', key: COMMENTS_TIMER, at: debounceAt(ctx) });
}

function debounceAt(ctx: Ctx): Date {
  return addMs(ctx.now, ctx.rules.debounce_seconds * 1000);
}

/** GitHub comments have no severity or category; they come in as minor / other. */
function githubPointContent(body: string, path: string | null, line: number | null, side: ExternalComment['side']) {
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '(empty comment)';
  return {
    path,
    line,
    side,
    severity: 'minor' as const,
    category: 'other' as const,
    title: firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine,
    body: body.trim() ? body.slice(0, 4000) : '(empty comment)',
    snippet: null,
  };
}
```

- [x] **Step 4: Route the events in `decide.ts`**

In `apps/server/src/engine/decide.ts`, add the import and the cases before `default`:
```ts
import {
  onCommentDeleted, onExternalComment, onHeadUpdated, onReviewSubmitted, onThreadResolved, onThreadUnresolved, onTimer,
} from './external';
```
```ts
    case 'external_comment': onExternalComment(ctx, event); break;
    case 'external_comment_deleted': onCommentDeleted(ctx, event); break;
    case 'external_review_submitted': onReviewSubmitted(ctx, event); break;
    case 'thread_resolved': onThreadResolved(ctx, event); break;
    case 'thread_unresolved': onThreadUnresolved(ctx, event); break;
    case 'head_updated': onHeadUpdated(ctx, event); break;
    case 'timer': onTimer(ctx, event); break;
```

- [x] **Step 5: Run the tests to see them pass**

Run: `npm run test -w apps/server -- src/engine && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (external, results, lifecycle), with no type or lint errors.

- [x] **Step 6: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): GitHub comments, reviews, threads, pushes and timers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Job failures, retries and an exhaustive `decide`

**Files:**
- Modify: `apps/server/src/engine/results.ts` (add `onJobFailed`), `apps/server/src/engine/decide.ts` (add the last case, make the switch exhaustive)
- Create: `apps/server/src/engine/failures.test.ts`

**Interfaces:**
- Consumes: `results.ts`, `context.ts`.
- Produces: `onJobFailed(ctx, e)`, `MAX_ATTEMPTS = 3`. After this task, `decide` handles every `DomainEvent`, and TypeScript fails the build if a new event type is added without a case.

Rules covered (§9.4):
- A retryable failure goes back to `queued` with a backoff, up to 3 attempts.
- Quota errors don't count as attempts. Neither does `daily_cap`, `repo_not_linked`, or a branch that moved under the job.
- A final failure sets the participant's attention to `failed` and notifies them.

- [x] **Step 1: Write the failing tests**

`apps/server/src/engine/failures.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { T0, agentToAgent, commandsOf, jobOf, leo, run } from './test-builders';
import type { FailureReason } from '@nitpilot/protocol';

function failing(attempt: number, reason: FailureReason, retryable: boolean) {
  const chat = agentToAgent({ phase: 'reviewing', jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { attempt })] });
  return run(chat, { type: 'job_failed', jobId: 'job-r1', reason, retryable });
}

const after = (ms: number) => new Date(T0.getTime() + ms);

describe('job_failed', () => {
  it.each([
    [1, 30_000],
    [2, 60_000],
  ])('retries a retryable failure on attempt %i after %i ms', (attempt, delay) => {
    const out = failing(attempt, 'crash', true);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: after(delay), refundAttempt: false }]);
    expect(out.chat.jobs[0]!.status).toBe('queued');
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('none');
  });

  it('gives up after the third attempt and tells the owner', () => {
    const out = failing(3, 'crash', true);
    expect(commandsOf(out, 'fail_job')).toEqual([{ type: 'fail_job', jobId: 'job-r1', reason: 'crash' }]);
    expect(out.chat.participants.find((p) => p.login === 'leo')!.attention).toBe('failed');
    expect(commandsOf(out, 'notify')).toEqual([{ type: 'notify', userIds: ['user-leo'], kind: 'failed', pointNumbers: [] }]);
  });

  it('gives up at once on a failure that is not retryable', () => {
    const out = failing(1, 'auth', false);
    expect(commandsOf(out, 'fail_job')).toHaveLength(1);
  });

  it.each([
    ['quota', 15 * 60_000],
    ['daily_cap', 60 * 60_000],
    ['repo_not_linked', 10 * 60_000],
  ] as const)('waits after %s without counting an attempt', (reason, delay) => {
    const out = failing(3, reason, true);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: after(delay), refundAttempt: true }]);
  });

  it.each(['stale_head', 'branch_moved'] as const)('runs again right away after %s', (reason) => {
    const out = failing(2, reason, false);
    expect(commandsOf(out, 'retry_job')).toEqual([{ type: 'retry_job', jobId: 'job-r1', runAfter: T0, refundAttempt: true }]);
  });

  it('ignores a failure from a job that is no longer running', () => {
    const chat = agentToAgent({ jobs: [jobOf('job-r1', leo, 'reviewer', 'review', { status: 'cancelled' })] });
    const out = run(chat, { type: 'job_failed', jobId: 'job-r1', reason: 'crash', retryable: true });
    expect(out.commands).toEqual([]);
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm run test -w apps/server -- src/engine/failures.test.ts`
Expected: FAIL. `retry_job` commands are `[]`, because `job_failed` still hits `default`.

- [x] **Step 3: Add `onJobFailed` to `results.ts`**

In `apps/server/src/engine/results.ts`, add `FailureReason` to the `@nitpilot/protocol` type import and `addMs` to the `./context` import:
```ts
import type { FailureReason, JobResult, PointReply, Severity } from '@nitpilot/protocol';
import { addMs, emit, say, system, type Ctx, type Ev } from './context';
```

Append:
```ts
export const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 30_000;
/** The branch moved under the job: run it again on the new head right away. */
const RUN_AGAIN_NOW: readonly FailureReason[] = ['stale_head', 'branch_moved'];
/** Not the agent's fault: wait, then try again without counting an attempt. */
const WAIT_MS: Partial<Record<FailureReason, number>> = {
  quota: 15 * 60_000,
  daily_cap: 60 * 60_000,
  repo_not_linked: 10 * 60_000,
};

export function onJobFailed(ctx: Ctx, e: Ev<'job_failed'>): void {
  const chat = ctx.chat;
  const job = chat.jobs.find((j) => j.id === e.jobId);
  if (!job || job.status !== 'running') return;
  const p = participant(chat, job.participantGithubId, job.role);
  const name = p ? `${p.login}'s agent` : 'An agent';

  if (RUN_AGAIN_NOW.includes(e.reason)) {
    requeue(ctx, job, ctx.now, true);
    return;
  }
  const wait = WAIT_MS[e.reason];
  if (wait !== undefined) {
    requeue(ctx, job, addMs(ctx.now, wait), true);
    system(ctx, `${name} is waiting (${e.reason.replaceAll('_', ' ')}) and will try again later`, { reason: e.reason });
    return;
  }
  if (e.retryable && job.attempt < MAX_ATTEMPTS) {
    requeue(ctx, job, addMs(ctx.now, RETRY_BASE_MS * 2 ** (job.attempt - 1)), false);
    return;
  }

  job.status = 'failed';
  emit(ctx, { type: 'fail_job', jobId: job.id, reason: e.reason });
  system(ctx, `${name} couldn't finish (${e.reason.replaceAll('_', ' ')})`, { reason: e.reason, jobId: job.id });
  if (p) {
    p.attention = 'failed';
    if (p.userId) emit(ctx, { type: 'notify', userIds: [p.userId], kind: 'failed', pointNumbers: [] });
  }
  // No advance() here: a person decides what happens next (the Retry button arrives in Plan 2).
}

function requeue(ctx: Ctx, job: JobView, runAfter: Date, refundAttempt: boolean): void {
  job.status = 'queued';
  emit(ctx, { type: 'retry_job', jobId: job.id, runAfter, refundAttempt });
}
```

- [x] **Step 4: Make `decide` exhaustive**

In `apps/server/src/engine/decide.ts`:
- Change the results import to `import { onJobCompleted, onJobFailed } from './results';`.
- Replace the `// Tasks 8–10 …` comment and the `default: break;` with:
```ts
    case 'job_failed': onJobFailed(ctx, event); break;
    default: {
      // If a new DomainEvent type is added without a case, this line stops compiling.
      const unhandled: never = event;
      throw new Error(`Unhandled event: ${JSON.stringify(unhandled)}`);
    }
```

- [x] **Step 5: Run every engine test**

Run: `npm run test -w apps/server -- src/engine && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (failures, external, results, lifecycle, rules, purity), with no type or lint errors.

- [x] **Step 6: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): job failures and retries; decide handles every event

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Summary comment renderer

**Files:**
- Create: `apps/server/src/engine/summary.ts`, `apps/server/src/engine/summary.test.ts`

**Interfaces:**
- Consumes: protocol enums and `BRAND`.
- Produces: `SUMMARY_MAX = 60_000`, `SummaryPoint`, `SummaryView`, and `renderSummary(view, clean?) → { body, hash }`. `clean` lets the caller sanitize agent text (Task 25) without the engine knowing how.

The format is spec §15's example. The body starts with the hidden marker `<!-- nitpilot:v1 chat=<id> -->`, so Nitpilot can recognize its own comment (Review Focus #1).

- [x] **Step 1: Write the failing test**

`apps/server/src/engine/summary.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { renderSummary, SUMMARY_MAX, type SummaryPoint, type SummaryView } from './summary';

function point(number: number, over: Partial<SummaryPoint> = {}): SummaryPoint {
  return { number, title: `Point ${number}`, status: 'resolved', authorResolution: 'fixed', escalationReason: null, fixedIn: 'a1b2c3d4e5', authorComment: null, ...over };
}

const view = (over: Partial<SummaryView> = {}): SummaryView => ({
  chatId: 'chat_1',
  phase: 'ready',
  merged: false,
  round: 2,
  transcriptUrl: 'https://nitpilot.dev/c/octo/sandbox/42',
  points: [
    point(1, { title: '`parseOrder` crashes on empty input' }),
    point(2, { title: 'Rename `fetchAll` → `fetchPage`', authorResolution: 'declined', fixedIn: null, authorComment: 'Kept for API compatibility.' }),
    point(3, { title: 'Missing pagination test', fixedIn: 'd4e5f6a7b8' }),
  ],
  ...over,
});

describe('renderSummary', () => {
  it('renders the spec format', () => {
    expect(renderSummary(view()).body).toBe(
      [
        '<!-- nitpilot:v1 chat=chat_1 -->',
        '🤖 **Nitpilot** · ready for approval · 2 rounds',
        'Fixed: `parseOrder` crashes on empty input (P1), Missing pagination test (P3)',
        'Declined, reviewer agreed: Rename `fetchAll` → `fetchPage` (P2, Kept for API compatibility.)',
        'Needs a human: none',
        '<details><summary>Review log (3 points)</summary>',
        '',
        '| # | Point | Outcome |',
        '|---|---|---|',
        '| P1 | `parseOrder` crashes on empty input | fixed in a1b2c3d |',
        '| P2 | Rename `fetchAll` → `fetchPage` | declined, resolved by reviewer |',
        '| P3 | Missing pagination test | fixed in d4e5f6a |',
        '</details>',
        '',
        '[Open the conversation →](https://nitpilot.dev/c/octo/sandbox/42)',
      ].join('\n'),
    );
  });

  it('names escalated points and labels a merged PR', () => {
    const body = renderSummary(view({ phase: 'closed', merged: true, points: [point(1, { status: 'escalated', escalationReason: 'category', title: 'SQL injection', authorResolution: null })] })).body;
    expect(body).toContain('🤖 **Nitpilot** · merged · 2 rounds');
    expect(body).toContain('Needs a human: SQL injection (P1)');
    expect(body).toContain('| P1 | SQL injection | needs a human (always escalated) |');
  });

  it('keeps table cells on one line and escapes pipes', () => {
    const body = renderSummary(view({ points: [point(1, { title: 'a | b\nc' })] })).body;
    expect(body).toContain('| P1 | a \\| b c |');
  });

  it(`stays under ${SUMMARY_MAX} characters and points to the chat for the rest`, () => {
    const many = Array.from({ length: 600 }, (_, i) => point(i + 1, { title: 'x'.repeat(150), status: 'open', authorResolution: null }));
    const body = renderSummary(view({ points: many })).body;
    expect(body.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(body).toMatch(/\| … \| \+\d+ more in chat \| \|/);
    expect(body.endsWith('[Open the conversation →](https://nitpilot.dev/c/octo/sandbox/42)')).toBe(true);
  });

  it('passes titles through the clean function', () => {
    const body = renderSummary(view({ points: [point(1, { title: 'ping @everyone' })] }), (t) => t.replace('@', '@​')).body;
    expect(body).toContain('ping @​everyone');
  });

  it('gives the same hash for the same content, and a new one when it changes', () => {
    expect(renderSummary(view()).hash).toBe(renderSummary(view()).hash);
    expect(renderSummary(view()).hash).not.toBe(renderSummary(view({ round: 3 })).hash);
  });
});
```

- [x] **Step 2: Run the test to see it fail**

Run: `npm run test -w apps/server -- src/engine/summary.test.ts`
Expected: FAIL, `Failed to resolve import "./summary"`.

- [x] **Step 3: Write `summary.ts`**

`apps/server/src/engine/summary.ts`:
```ts
import { createHash } from 'node:crypto';
import { BRAND, type EscalationReason, type Phase, type PointStatus, type Resolution } from '@nitpilot/protocol';

/** GitHub allows 65,536 characters per comment; stay safely below (spec §15). */
export const SUMMARY_MAX = 60_000;

export type SummaryPoint = {
  number: number;
  title: string;
  status: PointStatus;
  authorResolution: Resolution | null;
  escalationReason: EscalationReason | null;
  /** The commit that fixed it, from the author agent's reply. */
  fixedIn: string | null;
  /** The author agent's reply, shown for declined points. */
  authorComment: string | null;
};

export type SummaryView = {
  chatId: string;
  phase: Phase;
  merged: boolean;
  round: number;
  transcriptUrl: string;
  points: SummaryPoint[];
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'waiting',
  reviewing: 'agents reviewing',
  addressing: 'agents fixing',
  ready: 'ready for approval',
  escalated: 'needs a human',
  closed: 'closed',
};

const ESCALATION_LABEL: Record<EscalationReason, string> = {
  category: 'always escalated',
  disagreement: 'disagreement',
  round_limit: 'round limit',
};

/** The one PR comment Nitpilot keeps up to date in agent-to-agent mode (spec §15). */
export function renderSummary(view: SummaryView, clean: (text: string) => string = (t) => t): { body: string; hash: string } {
  const title = (p: SummaryPoint) => clean(oneLine(p.title));
  const status = view.phase === 'closed' && view.merged ? 'merged' : PHASE_LABEL[view.phase];
  const fixed = view.points.filter((p) => p.status === 'resolved' && p.authorResolution === 'fixed');
  const declined = view.points.filter((p) => p.status === 'resolved' && p.authorResolution === 'declined');
  const human = view.points.filter((p) => p.status === 'escalated');

  const head = [
    `<!-- ${BRAND.commentMarker} chat=${view.chatId} -->`,
    `🤖 **${BRAND.name}** · ${status} · ${view.round} round${view.round === 1 ? '' : 's'}`,
  ];
  if (fixed.length > 0) head.push(`Fixed: ${fixed.map((p) => `${title(p)} (P${p.number})`).join(', ')}`);
  if (declined.length > 0) {
    head.push(`Declined, reviewer agreed: ${declined.map((p) => `${title(p)} (P${p.number}${p.authorComment ? `, ${clean(short(p.authorComment))}` : ''})`).join(', ')}`);
  }
  head.push(`Needs a human: ${human.length > 0 ? human.map((p) => `${title(p)} (P${p.number})`).join(', ') : 'none'}`);

  const rows = view.points.map((p) => `| P${p.number} | ${cell(title(p))} | ${outcome(p)} |`);
  const count = view.points.length;
  const build = (shown: string[]) =>
    [
      ...head,
      `<details><summary>Review log (${count} point${count === 1 ? '' : 's'})</summary>`,
      '',
      '| # | Point | Outcome |',
      '|---|---|---|',
      ...shown,
      ...(shown.length < rows.length ? [`| … | +${rows.length - shown.length} more in chat | |`] : []),
      '</details>',
      '',
      `[Open the conversation →](${view.transcriptUrl})`,
    ].join('\n');

  // Drop rows from the end until the comment fits.
  let shown = rows;
  let body = build(shown);
  while (body.length > SUMMARY_MAX && shown.length > 0) {
    shown = shown.slice(0, -1);
    body = build(shown);
  }
  return { body, hash: createHash('sha256').update(body).digest('hex') };
}

function outcome(p: SummaryPoint): string {
  switch (p.status) {
    case 'resolved':
      if (p.authorResolution === 'fixed') return p.fixedIn ? `fixed in ${p.fixedIn.slice(0, 7)}` : 'fixed';
      if (p.authorResolution === 'declined') return 'declined, resolved by reviewer';
      if (p.authorResolution === 'answered') return 'answered, resolved by reviewer';
      return 'resolved';
    case 'escalated':
      return `needs a human (${ESCALATION_LABEL[p.escalationReason ?? 'category']})`;
    case 'addressed':
      return `${p.authorResolution ?? 'answered'}, waiting for review`;
    case 'open':
      return 'open';
  }
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function short(text: string): string {
  const line = oneLine(text);
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}
```

- [x] **Step 4: Run the test to see it pass**

Run: `npm run test -w apps/server -- src/engine && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (6 summary tests plus all earlier engine tests).

- [x] **Step 5: Commit**

```bash
git add apps/server/src/engine
git commit -m "feat(engine): summary comment renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Milestone M3: Server foundations

### Task 12: Prisma schema, migration and DB test helpers

**Files:**
- Create: `apps/server/prisma/schema.prisma`, `apps/server/prisma.config.ts`, `apps/server/.env.example`, `apps/server/src/lib/prisma.ts`, `apps/server/src/lib/prisma.db.test.ts`, `apps/server/test/db.ts`
- Create (generated): `apps/server/prisma/migrations/<timestamp>_init/migration.sql`
- Modify: `apps/server/package.json` (scripts), `apps/server/vitest.config.ts` (unit/db projects)

**Interfaces:**
- Consumes: Postgres from Task 2.
- Produces:
  - `prisma` (singleton client), `type Tx` (a transaction client) and `isUniqueViolation(err)` from `src/lib/prisma.ts`;
  - from `test/db.ts`: `uid(prefix)`, `ghId()`, `makeUser()`, `makeRepo()`, `makeChat(repoId, over)` and `resetDb()`;
  - the scripts `db:migrate`, `db:deploy` and `db:generate`;
  - every model in spec §8 except `PushSubscription` (Plan 2), plus `SeenComment` (Task 23).
- Schema choices:
  - **`Job.activeFor`** holds the participant id while a job is queued or running and `null` afterwards. Its `@unique` constraint enforces "at most one active job per participant" (§9.4) without a raw-SQL partial index, which Prisma would try to drop in later migrations.
  - **Natural keys:** `Point.raisedByGithubId`, `Message.authorGithubId`/`authorLogin`/`pointNumber` (see "Decisions" at the top).
  - **`Point`** is unique on `(chatId, githubCommentId)`.

- [x] **Step 1: Install Prisma and the Postgres driver**

Run:
```bash
npm install @prisma/client@^7 @prisma/adapter-pg@^7 pg@^8 dotenv@^17 -w apps/server
npm install -D prisma@^7 @types/pg@^8 -w apps/server
```
Expected: `added … packages`.

- [x] **Step 2: Write the schema**

`apps/server/prisma/schema.prisma`:
```prisma
// Nitpilot data model (spec §8). Every platform id is a string.
// Status-like columns are plain strings; their allowed values are the zod enums in packages/protocol.

generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id        String   @id @default(cuid())
  githubId  String   @unique
  login     String
  avatarUrl String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  githubAuth    GithubAuth?
  sessions      WebSession[]
  cliTokens     CliToken[]
  loginRequests CliLoginRequest[]
  jobs          Job[]
}

/// The user's GitHub user access token (8 h) and refresh token (6 months, single use), encrypted.
model GithubAuth {
  id               String   @id @default(cuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessTokenEnc   String
  accessExpiresAt  DateTime
  refreshTokenEnc  String
  refreshExpiresAt DateTime
  /// Bumped on every refresh; a refresh only saves if the version didn't change meanwhile.
  version          Int      @default(0)
  /// ok | needs_reauth
  status           String   @default("ok")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model WebSession {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

/// One per CLI device. Only the sha256 of the token is stored.
model CliToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name       String
  tokenHash  String    @unique
  prefix     String
  lastSeenAt DateTime?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  jobs       Job[]
}

/// The `nitpilot login` handshake. The device code is stored only as a hash.
model CliLoginRequest {
  id             String   @id @default(cuid())
  deviceCodeHash String   @unique
  userCode       String   @unique
  deviceName     String
  /// pending | approved | consumed | denied | expired
  status         String   @default("pending")
  userId         String?
  user           User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt      DateTime
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model Installation {
  /// GitHub's installation id
  id           String    @id
  accountLogin String
  suspendedAt  DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  repos        Repo[]
}

model Repo {
  /// GitHub's repository id
  id             String       @id
  installationId String
  installation   Installation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  fullName       String       @unique
  private        Boolean
  defaultBranch  String
  /// Parsed .nitpilot.yml; null means the defaults apply.
  rulesJson      Json?
  rulesEtag      String?
  rulesError     String?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  chats          PrChat[]
}

model PrChat {
  id               String    @id @default(cuid())
  repoId           String
  repo             Repo      @relation(fields: [repoId], references: [id], onDelete: Cascade)
  number           Int
  title            String
  body             String    @default("")
  url              String
  authorGithubId   String
  /// idle | reviewing | addressing | ready | escalated | closed
  phase            String    @default("idle")
  round            Int       @default(1)
  addressPasses    Int       @default(0)
  headSha          String
  baseSha          String
  baseRef          String
  headRef          String
  /// null when the PR came from a fork that has been deleted
  headRepoFullName String?
  isDraft          Boolean   @default(false)
  trusted          Boolean   @default(false)
  lastSeq          Int       @default(0)
  pointCount       Int       @default(0)
  summaryCommentId String?
  summaryHash      String?
  merged           Boolean   @default(false)
  closedAt         DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  participants Participant[]
  points       Point[]
  messages     Message[]
  jobs         Job[]
  tasks        Task[]
  githubWrites GithubWrite[]

  @@unique([repoId, number])
}

model Participant {
  id              String   @id @default(cuid())
  chatId          String
  chat            PrChat   @relation(fields: [chatId], references: [id], onDelete: Cascade)
  githubId        String
  /// author | reviewer
  role            String
  /// Cache of User.id; null = not on Nitpilot. Refreshed every time the chat is loaded.
  userId          String?
  login           String
  isBot           Boolean  @default(false)
  auto            Boolean  @default(true)
  requested       Boolean  @default(false)
  lastReviewedSha String?
  /// none | decision | manual_review | failed | drafts
  attention       String   @default("none")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  jobs            Job[]

  @@unique([chatId, githubId, role])
}

model Point {
  id                 String   @id @default(cuid())
  chatId             String
  chat               PrChat   @relation(fields: [chatId], references: [id], onDelete: Cascade)
  /// Shown as P1, P2, …
  number             Int
  raisedByGithubId   String
  /// agent | github
  origin             String
  jobId              String?
  githubCommentId    String?
  githubThreadRootId String?
  path               String?
  line               Int?
  side               String?
  commitSha          String?
  severity           String
  category           String
  title              String
  body               String
  snippet            Json?
  /// open | addressed | resolved | escalated
  status             String   @default("open")
  authorResolution   String?
  escalationReason   String?
  trusted            Boolean  @default(true)
  round              Int
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([chatId, number])
  @@unique([chatId, githubCommentId])
}

/// One item in a chat's timeline. `seq` is the resume cursor (spec §10).
model Message {
  id             String   @id @default(cuid())
  chatId         String
  chat           PrChat   @relation(fields: [chatId], references: [id], onDelete: Cascade)
  seq            Int
  /// point_raised | point_reply | point_decision | job_summary | human | system
  kind           String
  /// null = a system event
  authorGithubId String?
  authorLogin    String?
  pointNumber    Int?
  jobId          String?
  body           String
  data           Json?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([chatId, seq])
}

model Job {
  id              String      @id @default(cuid())
  chatId          String
  chat            PrChat      @relation(fields: [chatId], references: [id], onDelete: Cascade)
  participantId   String
  participant     Participant @relation(fields: [participantId], references: [id], onDelete: Cascade)
  /// The participant id while this job is queued or running, null otherwise.
  /// Unique, so a participant can have at most one active job (spec §9.4).
  activeFor       String?     @unique
  userId          String
  user            User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// review | re_review | address
  type            String
  /// queued | running | done | failed | cancelled
  status          String      @default("queued")
  round           Int
  /// The PR head when queued. Plan 1b's assigner moves it to the latest head at assignment.
  headSha         String
  sinceSha        String?
  attempt         Int         @default(0)
  runAfter        DateTime    @default(now())
  cliTokenId      String?
  cliToken        CliToken?   @relation(fields: [cliTokenId], references: [id], onDelete: SetNull)
  leaseExpiresAt  DateTime?
  /// Announced by job.pushing, so the server recognizes its own push.
  expectedPushSha String?
  result          Json?
  /// pending | applied | draft | discarded
  applyState      String      @default("pending")
  failure         String?
  cancelReason    String?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  @@index([status, runAfter])
  @@index([chatId, expectedPushSha])
}

/// Server-side outbox and timers (spec §7). The task runner executes due rows.
model Task {
  id        String   @id @default(cuid())
  /// timer | summary | post_review | thread_replies | notify
  kind      String
  chatId    String?
  chat      PrChat?  @relation(fields: [chatId], references: [id], onDelete: Cascade)
  payload   Json
  runAt     DateTime @default(now())
  /// pending | running | done | failed
  status    String   @default("pending")
  attempts  Int      @default(0)
  lastError String?
  /// A debounce is an upsert on this key.
  dedupeKey String?  @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status, runAt])
}

/// Every webhook delivery, kept 14 days. The primary key stops double processing.
model RawEvent {
  /// X-GitHub-Delivery
  deliveryId String   @id
  event      String
  action     String?
  repoId     String?
  body       String
  /// received | processed | ignored | failed
  status     String   @default("received")
  note       String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([status])
  @@index([createdAt])
}

/// GitHub comment ids already handled. A comment can arrive on its own and again inside a
/// submitted review; this table makes sure it is handled once (Review Focus #3).
model SeenComment {
  commentId String   @id
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

/// Everything Nitpilot wrote to GitHub, so it can edit those writes and ignore their webhooks.
model GithubWrite {
  id        String   @id @default(cuid())
  chatId    String
  chat      PrChat   @relation(fields: [chatId], references: [id], onDelete: Cascade)
  /// summary | review | review_comment | reply
  kind      String
  githubId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([kind, githubId])
}
```

`apps/server/prisma.config.ts`:
```ts
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
});
```

`apps/server/.env.example` (Task 13 adds the rest):
```
# Postgres from docker-compose.yml (host port 5433)
DATABASE_URL=postgresql://nitpilot:nitpilot@localhost:5433/nitpilot
```

Add to `apps/server/package.json` `"scripts"`:
```json
"db:migrate": "prisma migrate dev",
"db:deploy": "prisma migrate deploy",
"db:generate": "prisma generate",
"postinstall": "prisma generate"
```

- [x] **Step 3: Create the first migration**

Run:
```bash
cp apps/server/.env.example apps/server/.env
npm run db:migrate -w apps/server -- --name init
```
Expected: `Your database is now in sync with your schema` and `Generated Prisma Client … to ./src/generated/prisma`.

- [x] **Step 4: Write the Prisma client module**

`apps/server/src/lib/prisma.ts`:
```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

/** A Prisma client inside `prisma.$transaction(async (tx) => …)`. */
export type Tx = Prisma.TransactionClient;

function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }), log: ['error'] });
}

// One client per process. In development, keep it on globalThis so hot reloads reuse it.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/** True when a write broke a unique constraint (Prisma error P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
```

- [x] **Step 5: Split the tests into unit and DB projects**

Replace `apps/server/vitest.config.ts`:
```ts
import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Values the server reads from the environment. Tests that care about one override it with vi.stubEnv.
const testEnv = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost:8787',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  GITHUB_APP_ID: '12345',
  GITHUB_APP_SLUG: 'nitpilot-dev',
  GITHUB_APP_PRIVATE_KEY: 'tests-that-need-a-key-generate-one',
  GITHUB_CLIENT_ID: 'Iv1.test',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
  PUBLIC_REPOS_ONLY: 'false',
  ALLOWED_LOGINS: '',
};

export default defineConfig({
  test: {
    env: testEnv,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.test.{ts,tsx}'], exclude: ['**/*.db.test.{ts,tsx}'] },
      },
      {
        // Real Postgres. Files run one at a time; tests use unique data (see test/db.ts).
        extends: true,
        test: { name: 'db', include: ['src/**/*.db.test.{ts,tsx}', 'test/**/*.db.test.ts'], fileParallelism: false, testTimeout: 20_000 },
      },
    ],
  },
});
```

Add to `apps/server/package.json` `"scripts"`:
```json
"test:unit": "vitest run --project unit",
"test:db": "vitest run --project db"
```

- [x] **Step 6: Write the DB test helpers**

`apps/server/test/db.ts`:
```ts
import type { Prisma } from '../src/generated/prisma/client';
import { prisma } from '../src/lib/prisma';

// Tests share one database, so every row they create uses values no other test uses.

let counter = 0;

export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A unique numeric id, like GitHub's. */
export function ghId(): string {
  counter += 1;
  return `${Date.now()}${counter}${Math.floor(Math.random() * 1000)}`;
}

export async function makeUser(over: { login?: string; githubId?: string } = {}) {
  return prisma.user.create({ data: { githubId: over.githubId ?? ghId(), login: over.login ?? uid('user') } });
}

export async function makeRepo(over: { private?: boolean; rulesJson?: Prisma.InputJsonValue } = {}) {
  const installation = await prisma.installation.create({ data: { id: ghId(), accountLogin: uid('org') } });
  return prisma.repo.create({
    data: {
      id: ghId(),
      installationId: installation.id,
      fullName: `${installation.accountLogin}/${uid('repo')}`,
      private: over.private ?? false,
      defaultBranch: 'main',
      ...(over.rulesJson !== undefined ? { rulesJson: over.rulesJson } : {}),
    },
  });
}

let prNumber = 0;

export async function makeChat(repoId: string, over: { number?: number; authorGithubId?: string; headSha?: string; trusted?: boolean } = {}) {
  prNumber += 1;
  const number = over.number ?? prNumber;
  const repo = await prisma.repo.findUniqueOrThrow({ where: { id: repoId } });
  return prisma.prChat.create({
    data: {
      repoId,
      number,
      title: `PR ${number}`,
      url: `https://github.com/${repo.fullName}/pull/${number}`,
      authorGithubId: over.authorGithubId ?? ghId(),
      headSha: over.headSha ?? 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      baseRef: 'main',
      headRef: `feature-${number}`,
      headRepoFullName: repo.fullName,
      trusted: over.trusted ?? true,
    },
  });
}

/** Empty every table. Only for tests of sweeps over all rows (task runner, replay, purge). */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Task", "RawEvent", "SeenComment", "GithubWrite", "Message", "Point", "Job", "Participant", "PrChat", "Repo", "Installation", "CliLoginRequest", "CliToken", "WebSession", "GithubAuth", "User" CASCADE',
  );
}
```

- [x] **Step 7: Write the schema tests**

`apps/server/src/lib/prisma.db.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ghId, makeChat, makeRepo, makeUser } from '../../test/db';
import { isUniqueViolation, prisma } from './prisma';

describe('schema', () => {
  it('deletes a chat and everything in it when its repo is deleted', async () => {
    const repo = await makeRepo();
    const chat = await makeChat(repo.id);
    await prisma.participant.create({ data: { chatId: chat.id, githubId: ghId(), role: 'author', login: 'maya' } });
    await prisma.message.create({ data: { chatId: chat.id, seq: 1, kind: 'system', body: 'hi' } });

    await prisma.installation.delete({ where: { id: repo.installationId } });

    expect(await prisma.prChat.findUnique({ where: { id: chat.id } })).toBeNull();
    expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(0);
  });

  it('allows only one active job per participant', async () => {
    const user = await makeUser();
    const chat = await makeChat((await makeRepo()).id);
    const p = await prisma.participant.create({ data: { chatId: chat.id, githubId: user.githubId, role: 'reviewer', login: user.login, userId: user.id } });
    const job = { chatId: chat.id, participantId: p.id, userId: user.id, type: 'review', round: 1, headSha: chat.headSha };

    const first = await prisma.job.create({ data: { ...job, activeFor: p.id } });
    const second = prisma.job.create({ data: { ...job, activeFor: p.id } });
    await expect(second).rejects.toSatisfy(isUniqueViolation);

    // Once the first job is done, a new one can start.
    await prisma.job.update({ where: { id: first.id }, data: { status: 'done', activeFor: null } });
    await expect(prisma.job.create({ data: { ...job, activeFor: p.id } })).resolves.toBeTruthy();
  });
});
```

- [x] **Step 8: Run the tests**

Run: `npm run test:db -w apps/server && npm run test:unit -w apps/server && npm run typecheck -w apps/server`
Expected: the `db` project PASSES with 2 tests, the `unit` project PASSES with every engine test, and there are no type errors.

- [x] **Step 9: Commit**

```bash
git add apps/server package.json package-lock.json
git commit -m "feat(server): Prisma schema, first migration and DB test helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Hono app, environment, singleton lock and boot

**Files:**
- Create: `apps/server/src/lib/env.ts`, `apps/server/src/lib/env.test.ts`, `apps/server/src/lib/advisory-lock.ts`, `apps/server/src/lib/advisory-lock.db.test.ts`, `apps/server/src/http/errors.ts`, `apps/server/src/http/app.ts`, `apps/server/src/http/app.test.ts`, `apps/server/src/main.ts`
- Create: `docs/why/one-process.md`
- Modify: `apps/server/.env.example`, `apps/server/package.json` (scripts `dev`, `start`)

**Interfaces:**
- Consumes: `prisma` (Task 12).
- Produces:
  - `getEnv(): Env` (validated, read fresh from `process.env` on every call so tests can stub it);
  - `HttpError(code, message)`, `ErrorCode` and `onError(err, c)`;
  - `createApp()` (the Hono app with `GET /healthz`; later tasks add route groups and its `deps` argument);
  - `acquireSingletonLock(databaseUrl, key?) → SingletonLock | null`.

- [x] **Step 1: Install Hono**

Run: `npm install hono@^4 @hono/node-server@^1 -w apps/server`
Expected: `added … packages`.

- [x] **Step 2: Write the failing tests**

`apps/server/src/lib/env.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnv } from './env';

afterEach(() => vi.unstubAllEnvs());

describe('getEnv', () => {
  it('reads the test environment', () => {
    const env = getEnv();
    expect(env.PORT).toBe(8787);
    expect(env.PUBLIC_REPOS_ONLY).toBe(false);
    expect(env.ALLOWED_LOGINS).toEqual([]);
  });

  it('turns escaped newlines in the app private key into real ones', () => {
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY', '-----BEGIN KEY-----\\nabc\\n-----END KEY-----');
    expect(getEnv().GITHUB_APP_PRIVATE_KEY).toBe('-----BEGIN KEY-----\nabc\n-----END KEY-----');
  });

  it('parses flags and lists', () => {
    vi.stubEnv('PUBLIC_REPOS_ONLY', 'true');
    vi.stubEnv('ALLOWED_LOGINS', ' Maya , leo ');
    expect(getEnv()).toMatchObject({ PUBLIC_REPOS_ONLY: true, ALLOWED_LOGINS: ['maya', 'leo'] });
  });

  it('names every missing variable', () => {
    vi.stubEnv('GITHUB_CLIENT_ID', '');
    vi.stubEnv('PUBLIC_URL', 'not a url');
    expect(() => getEnv()).toThrow(/GITHUB_CLIENT_ID[\s\S]*PUBLIC_URL|PUBLIC_URL[\s\S]*GITHUB_CLIENT_ID/);
  });
});
```

`apps/server/src/http/app.test.ts`:
```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app';
import { HttpError, onError } from './errors';

describe('createApp', () => {
  it('answers the health check', async () => {
    const res = await createApp().request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('onError', () => {
  const app = new Hono();
  app.onError(onError);
  app.get('/missing', () => { throw new HttpError('not_found', 'no such chat'); });
  app.get('/invalid', () => { z.object({ a: z.string() }).parse({}); return new Response(); });
  app.get('/boom', () => { throw new Error('secret detail'); });

  it('maps HttpError to its status and a JSON body', async () => {
    const res = await app.request('/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'no such chat' } });
  });

  it('maps zod errors to 400', async () => {
    const res = await app.request('/invalid');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('validation_error');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret detail');
  });
});
```

`apps/server/src/lib/advisory-lock.db.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { acquireSingletonLock } from './advisory-lock';

describe('acquireSingletonLock', () => {
  it('lets only one process hold the lock at a time', async () => {
    const url = process.env.DATABASE_URL!;
    const key = 900_000 + Math.floor(Math.random() * 99_999); // a key no dev server uses

    const first = await acquireSingletonLock(url, key);
    expect(first).not.toBeNull();
    expect(await acquireSingletonLock(url, key)).toBeNull();

    await first!.release();
    const again = await acquireSingletonLock(url, key);
    expect(again).not.toBeNull();
    await again!.release();
  });
});
```

- [x] **Step 3: Run the tests to see them fail**

Run: `npm test -w apps/server`
Expected: FAIL, `Failed to resolve import "./env"`, `"./app"` and `"./advisory-lock"`.

- [x] **Step 4: Write the environment reader**

`apps/server/src/lib/env.ts`:
```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  /** Where people reach this server, e.g. https://nitpilot.dev. Used for links and OAuth. */
  PUBLIC_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  /** base64 of 32 random bytes: `openssl rand -base64 32` */
  ENCRYPTION_KEY: z.string().min(1),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1),
  /** The app's private key (PEM). `\n` escapes are allowed so it fits on one line. */
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).transform((k) => k.replaceAll('\\n', '\n')),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  /** Hosted instance: ignore private repos (spec §14.9). */
  PUBLIC_REPOS_ONLY: z.stringbool().default(false),
  /** Optional beta gate: comma-separated GitHub logins allowed to sign in. Empty = everyone. */
  ALLOWED_LOGINS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean)),
});

export type Env = z.infer<typeof EnvSchema>;

/** Read and check the environment. Throws one error naming every bad variable. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment:\n  ${problems}\nSee apps/server/.env.example.`);
  }
  return parsed.data;
}
```

- [x] **Step 5: Write the error mapping and the app**

`apps/server/src/http/errors.ts`:
```ts
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'conflict'
  | 'payload_too_large'
  | 'server_error';

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  payload_too_large: 413,
  server_error: 500,
};

/** Throw this from a route to answer with a specific status and message. */
export class HttpError extends Error {
  constructor(readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorBody(code: ErrorCode, message: string, details?: Record<string, unknown>) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/** Every error a route throws ends up here (Odyhook's withApiAuth pattern, as Hono's onError). */
export function onError(err: Error, c: Context): Response {
  if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), STATUS[err.code]);
  if (err instanceof ZodError) return c.json(errorBody('validation_error', 'request validation failed', { issues: err.issues }), 400);
  if (err instanceof SyntaxError) return c.json(errorBody('validation_error', 'invalid JSON body'), 400);
  if (err instanceof HTTPException) return err.getResponse();
  console.error('[http] unhandled error:', err);
  return c.json(errorBody('server_error', 'internal server error'), 500);
}
```

`apps/server/src/http/app.ts`:
```ts
import { Hono } from 'hono';
import { SERVER_VERSION } from '../version';
import { onError } from './errors';

/** The HTTP app. Later tasks mount their route groups here. */
export function createApp(): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/healthz', (c) => c.json({ ok: true, version: SERVER_VERSION }));
  return app;
}
```

- [x] **Step 6: Write the singleton lock and the boot file**

`apps/server/src/lib/advisory-lock.ts`:
```ts
import pg from 'pg';

/** "nitpilot" typed on a phone keypad. Any fixed number works; it just has to be the same everywhere. */
export const SINGLETON_LOCK_KEY = 64874568;

export type SingletonLock = { release(): Promise<void> };

/**
 * Take a Postgres advisory lock, so only one Nitpilot server runs against a database.
 * The per-chat locks and WebSocket hubs live in memory, so a second process would break
 * them (spec §7). The lock lives as long as this dedicated connection stays open.
 * Returns null when another process already holds it.
 */
export async function acquireSingletonLock(databaseUrl: string, key = SINGLETON_LOCK_KEY): Promise<SingletonLock | null> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
  if (!rows[0]?.locked) {
    await client.end();
    return null;
  }
  return {
    async release() {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
      await client.end();
    },
  };
}
```

`apps/server/src/main.ts`:
```ts
import { serve } from '@hono/node-server';
import { createApp } from './http/app';
import { acquireSingletonLock } from './lib/advisory-lock';
import { getEnv } from './lib/env';

async function main(): Promise<void> {
  const env = getEnv();

  const lock = await acquireSingletonLock(env.DATABASE_URL);
  if (!lock) {
    console.error('Another Nitpilot server is already running against this database. Refusing to start.');
    process.exit(1);
  }

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}`);
  });

  const shutdown = async () => {
    server.close();
    await lock.release();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Add to `apps/server/package.json` `"scripts"`:
```json
"dev": "tsx watch src/main.ts",
"start": "tsx src/main.ts"
```

Replace `apps/server/.env.example` with:
```
# Postgres from docker-compose.yml (host port 5433)
DATABASE_URL=postgresql://nitpilot:nitpilot@localhost:5433/nitpilot
PORT=8787
# Where people reach this server. Locally that's your machine; with the dev tunnel it's the tunnel URL.
PUBLIC_URL=http://localhost:8787
# openssl rand -base64 32
ENCRYPTION_KEY=

# From your dev GitHub App "nitpilot-dev" (Settings → Developer settings → GitHub Apps)
GITHUB_APP_ID=
GITHUB_APP_SLUG=nitpilot-dev
# The app's private key; paste it on one line with \n for the line breaks
GITHUB_APP_PRIVATE_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=

# Hosted instance only
PUBLIC_REPOS_ONLY=false
ALLOWED_LOGINS=
```

- [x] **Step 7: Run the tests to see them pass**

Run: `npm test -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (env 4, app 4, advisory lock 1, plus everything earlier).

- [x] **Step 8: Start the server by hand once**

Copy the new keys from `apps/server/.env.example` into `apps/server/.env`. Set `ENCRYPTION_KEY` (`openssl rand -base64 32`) and put any placeholder text in the `GITHUB_*` values for now; Task 19 replaces them with the real dev app. Then run `npm run dev -w apps/server`, and in a second terminal:
```bash
curl -s localhost:8787/healthz
npm run start -w apps/server
```
Expected: `{"ok":true,"version":"0.1.0"}`, and the second server prints "Another Nitpilot server is already running against this database. Refusing to start." and exits. Stop the first server with Ctrl-C.

- [x] **Step 9: Write the explainer**

`docs/why/one-process.md`:
```markdown
# Why one process (and no Redis)

**In one sentence:** the Nitpilot server only receives, stores and forwards; the heavy work (running agents) happens on each developer's laptop, so one Node process plus Postgres is enough.

## What a "worker" or "queue" would normally do

Many backends split into a web process, worker processes and a queue (Redis, SQS) between them. That's useful when the server does slow work itself. Nitpilot's server doesn't: it checks webhooks, runs pure rules, writes rows and sends small messages. Odyhook needed BullMQ and Redis because it sends webhooks itself; Nitpilot doesn't.

## What we use instead

- **Postgres is the source of truth.** Jobs, timers and pending GitHub writes are rows, so a restart loses nothing (`docs/why/outbox-and-restarts.md`).
- **In-memory locks per chat.** Two events for the same PR are handled one after the other (`lib/key-lock.ts`). That only works if there's a single process.
- **An advisory lock makes "single process" a rule, not a hope.** At boot the server asks Postgres for lock number 64874568 (`lib/advisory-lock.ts`). If another server holds it, the new one refuses to start.

## The React analogy

It's like keeping app state in a single store instead of syncing several: simpler, as long as you only have one tab. The advisory lock is the check that you really do have only one tab.
```

- [x] **Step 10: Commit**

```bash
git add apps/server docs/why/one-process.md package-lock.json
git commit -m "feat(server): Hono app, env validation, singleton lock and boot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Security primitives (ported from Odyhook)

**Files:**
- Create: `apps/server/src/lib/crypto.ts`, `apps/server/src/lib/crypto.test.ts`, `apps/server/src/lib/tokens.ts`, `apps/server/src/lib/tokens.test.ts`, `apps/server/src/lib/hmac.ts`, `apps/server/src/lib/hmac.test.ts`, `apps/server/src/lib/csrf.ts`, `apps/server/src/lib/csrf.test.ts`

**Interfaces:**
- Consumes: `BRAND`.
- Produces:
  - `encrypt(plaintext)` / `decrypt(payload)` (AES-256-GCM, key from `ENCRYPTION_KEY`);
  - `hashToken(raw)`, `generateToken() → { raw, hash, prefix }` (`nit_` prefix), `parseBearer(header)`, `randomSecret(bytes?)` and `generateUserCode()` (`WDJB-MJHT` style);
  - `verifyGithubSignature(rawBody, header, secret)` and `signGithubBody(rawBody, secret)`;
  - `isAllowedOrigin(req, publicUrl)`.

Read the Odyhook originals first; these are close ports:
- `~/Desktop/PracticeProjects/hooksmith/src/lib/crypto.ts`
- `~/Desktop/PracticeProjects/hooksmith/src/lib/api/token.ts`
- `~/Desktop/PracticeProjects/hooksmith/src/lib/hmac.ts`
- `~/Desktop/PracticeProjects/hooksmith/src/lib/csrf.ts`

- [x] **Step 1: Write the failing tests**

`apps/server/src/lib/crypto.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';

describe('encrypt / decrypt', () => {
  it('round-trips and uses a fresh IV every time', () => {
    const a = encrypt('gho_secret');
    const b = encrypt('gho_secret');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('gho_secret');
  });

  it('refuses tampered ciphertext', () => {
    const buf = Buffer.from(encrypt('gho_secret'), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString('base64'))).toThrow();
  });
});
```

`apps/server/src/lib/tokens.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { generateToken, generateUserCode, hashToken, parseBearer } from './tokens';

describe('tokens', () => {
  it('generates nit_ tokens and stores only a hash and a short prefix', () => {
    const t = generateToken();
    expect(t.raw).toMatch(/^nit_[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toBe(hashToken(t.raw));
    expect(t.prefix).toBe(t.raw.slice(0, 8));
  });

  it('reads a bearer header', () => {
    expect(parseBearer('Bearer nit_abc')).toBe('nit_abc');
    expect(parseBearer('bearer nit_abc')).toBe('nit_abc');
    expect(parseBearer('Basic x')).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
  });

  it('makes user codes that are easy to read aloud', () => {
    for (let i = 0; i < 50; i++) expect(generateUserCode()).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
  });
});
```

`apps/server/src/lib/hmac.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { signGithubBody, verifyGithubSignature } from './hmac';

describe('verifyGithubSignature', () => {
  const body = '{"action":"opened"}';

  it('accepts the right signature', () => {
    expect(verifyGithubSignature(body, signGithubBody(body, 's3cret'), 's3cret')).toBe(true);
  });

  it.each([
    ['a wrong secret', signGithubBody(body, 'other')],
    ['a missing header', null],
    ['no sha256= prefix', signGithubBody(body, 's3cret').slice('sha256='.length)],
    ['same length but not hex', `sha256=${'z'.repeat(64)}`],
    ['a short signature', 'sha256=abcd'],
  ])('rejects %s', (_label, header) => {
    expect(verifyGithubSignature(body, header, 's3cret')).toBe(false);
  });

  it('rejects a body that changed by one byte', () => {
    expect(verifyGithubSignature(`${body} `, signGithubBody(body, 's3cret'), 's3cret')).toBe(false);
  });
});
```

`apps/server/src/lib/csrf.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './csrf';

const PUBLIC = 'https://nitpilot.dev';
const req = (headers: Record<string, string>) => new Request('http://10.0.0.5:8787/cli/approve', { method: 'POST', headers });

describe('isAllowedOrigin', () => {
  it('accepts the public origin', () => expect(isAllowedOrigin(req({ origin: PUBLIC }), PUBLIC)).toBe(true));
  it("accepts the request's own origin", () => expect(isAllowedOrigin(req({ origin: 'http://10.0.0.5:8787' }), PUBLIC)).toBe(true));
  it('falls back to the referer', () => expect(isAllowedOrigin(req({ referer: `${PUBLIC}/cli/approve?code=X` }), PUBLIC)).toBe(true));
  it('rejects another site', () => expect(isAllowedOrigin(req({ origin: 'https://evil.example' }), PUBLIC)).toBe(false));
  it('rejects a request with neither header', () => expect(isAllowedOrigin(req({}), PUBLIC)).toBe(false));
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm run test:unit -w apps/server`
Expected: FAIL, `Failed to resolve import "./crypto"` (and the other three).

- [x] **Step 3: Write the four modules**

`apps/server/src/lib/crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for secrets at rest (GitHub tokens, the OAuth state cookie).
// Ported from Odyhook's src/lib/crypto.ts. Output: base64 of iv || tag || ciphertext.

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedRaw: string | null = null;
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set');
  if (cachedKey && cachedRaw === raw) return cachedKey;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`);
  cachedRaw = raw;
  cachedKey = key;
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Throws if the payload was tampered with. */
export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const decipher = createDecipheriv(ALGO, getKey(), buf.subarray(0, IV_LEN));
  decipher.setAuthTag(buf.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([decipher.update(buf.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString('utf8');
}
```

`apps/server/src/lib/tokens.ts`:
```ts
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { BRAND } from '@nitpilot/protocol';

export type GeneratedToken = { raw: string; hash: string; prefix: string };

/** sha256 hex of a raw token. The only form we store. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** A new CLI token. `raw` is shown to the CLI once and never stored. */
export function generateToken(): GeneratedToken {
  const raw = BRAND.tokenPrefix + randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw), prefix: raw.slice(0, BRAND.tokenPrefix.length + 4) };
}

export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  return m ? m[1]! : null;
}

/** A random URL-safe secret: session tokens, device codes, PKCE verifiers. */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// No vowels (no accidental words) and no lookalike characters.
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

/** The code a person compares between terminal and browser, e.g. WDJB-MJHT. */
export function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
```

`apps/server/src/lib/hmac.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const HEX = /^[0-9a-f]+$/i;

/**
 * Check GitHub's X-Hub-Signature-256 against the raw body, in constant time.
 * Malformed input is a plain mismatch, never an exception (Odyhook's src/lib/hmac.ts).
 */
export function verifyGithubSignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const received = header.slice('sha256='.length);
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (received.length !== expected.length || !HEX.test(received)) return false;
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}

/** Sign a body the way GitHub does. Used by tests and dev tools. */
export function signGithubBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}
```

`apps/server/src/lib/csrf.ts`:
```ts
// Origin check for cookie-authenticated, state-changing requests (Odyhook's src/lib/csrf.ts).
// Browsers send Origin on POSTs; if it isn't ours, the request came from another site.

function refererOrigin(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** True if the request comes from our own pages. */
export function isAllowedOrigin(req: Request, publicUrl: string): boolean {
  const candidate = req.headers.get('origin') ?? refererOrigin(req.headers.get('referer'));
  if (!candidate) return false;
  const allowed = new Set([new URL(publicUrl).origin, new URL(req.url).origin]);
  return allowed.has(candidate);
}
```

- [x] **Step 4: Run the tests to see them pass**

Run: `npm run test:unit -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (crypto 2, tokens 3, hmac 7, csrf 5).

- [x] **Step 5: Commit**

```bash
git add apps/server/src/lib
git commit -m "feat(server): port crypto, tokens, HMAC and origin check from Odyhook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: GitHub sign-in with PKCE

**Files:**
- Create: `apps/server/src/platform/github/client.ts`, `apps/server/src/auth/github-oauth.ts`, `apps/server/src/auth/users.ts`, `apps/server/src/auth/session.ts`, `apps/server/src/http/routes/auth.ts`, `apps/server/src/http/pages/layout.tsx`, `apps/server/src/http/pages/home.tsx`, `apps/server/src/http/routes/auth.db.test.ts`, `apps/server/src/auth/github-oauth.test.ts`
- Create: `apps/server/test/fake-fetch.ts`, `apps/server/test/http.ts`
- Create: `docs/why/oauth-pkce.md`
- Modify: `apps/server/src/http/app.ts`, `apps/server/src/http/app.test.ts`, `apps/server/src/main.ts`

**Interfaces:**
- Consumes: `encrypt`/`decrypt`, `randomSecret`, `hashToken`, `isAllowedOrigin`, `getEnv`, `HttpError`, `prisma`.
- Produces:
  - `GithubClient` (`api<T>(method, path, opts)` and `oauth<T>(path, params)`), `GithubError`, `FetchLike`;
  - `pkceChallenge(verifier)`, `authorizeUrl(...)`, `exchangeCode(...)`, `refreshTokens(...)`, `fetchGithubUser(...)` and `type OAuthTokens`;
  - `saveGithubUser(ghUser, tokens) → User`;
  - `startSession(c, userId)`, `currentUser(c) → SessionUser | null`, `endSession(c)`, `cookieOptions(maxAge)` and `type SessionUser`;
  - `renderPage(c, page, status?)` and `Layout`;
  - `createApp({ github })`; the type is `AppDeps = { github: GithubClient }`, and later tasks add fields;
  - test helpers `fakeFetch(routes)`, `json(data, status?, headers?)`, `cookieHeader(res)` and `sessionCookieFor(userId)`.
- Routes: `GET /` (home), `GET /auth/github/login?next=`, `GET /auth/github/callback`, `POST /auth/logout`.

- [x] **Step 1: Write the test helpers**

`apps/server/test/fake-fetch.ts`:
```ts
import type { FetchLike } from '../src/platform/github/client';

export type FakeRequest = { method: string; url: URL; headers: Headers; body: unknown };
type Handler = (req: FakeRequest) => unknown;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const body = data === null || status === 204 || status === 304 ? null : JSON.stringify(data);
  return new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * A fetch that answers from a route table like `{ 'GET /user': () => ({ id: 1 }) }`.
 * A handler may return plain data (sent as 200 JSON) or a Response. Unknown routes throw,
 * so a test notices any call it didn't expect. Every call is recorded in `.calls`.
 */
export function fakeFetch(routes: Record<string, Handler>): FetchLike & { calls: FakeRequest[] } {
  const calls: FakeRequest[] = [];
  const fn = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const raw = typeof init.body === 'string' ? init.body : null;
    const req: FakeRequest = { method, url, headers: new Headers(init.headers), body: raw ? JSON.parse(raw) : null };
    calls.push(req);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) throw new Error(`fakeFetch: no route for ${method} ${url.pathname}`);
    const out = await handler(req);
    return out instanceof Response ? out : json(out);
  };
  return Object.assign(fn, { calls });
}
```

`apps/server/test/http.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';
import { prisma } from '../src/lib/prisma';
import { hashToken, randomSecret } from '../src/lib/tokens';

/** The cookies a response set, as a `cookie` request header. */
export function cookieHeader(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

/** A signed-in browser for `userId`: a real WebSession row and its cookie. */
export async function sessionCookieFor(userId: string): Promise<string> {
  const raw = randomSecret();
  await prisma.webSession.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) } });
  return `${BRAND.sessionCookie}=${raw}`;
}
```

- [x] **Step 2: Write the failing tests**

`apps/server/src/auth/github-oauth.test.ts`:
```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../test/fake-fetch';
import { GithubClient, GithubError } from '../platform/github/client';
import { authorizeUrl, exchangeCode, pkceChallenge } from './github-oauth';

describe('PKCE', () => {
  it('uses the S256 challenge: base64url(sha256(verifier))', () => {
    expect(pkceChallenge('verifier-123')).toBe(createHash('sha256').update('verifier-123').digest('base64url'));
  });

  it('builds the authorize URL', () => {
    const url = new URL(authorizeUrl({ webBase: 'https://github.com', clientId: 'Iv1.x', redirectUri: 'http://localhost:8787/auth/github/callback', state: 'st', codeChallenge: 'ch' }));
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'Iv1.x',
      redirect_uri: 'http://localhost:8787/auth/github/callback',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });
});

describe('exchangeCode', () => {
  const now = new Date('2026-10-07T18:00:00Z');

  it('returns the tokens with absolute expiry times', async () => {
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': () => ({ access_token: 'ghu_a', expires_in: 28_800, refresh_token: 'ghr_r', refresh_token_expires_in: 15_811_200 }) });
    const tokens = await exchangeCode(new GithubClient(fetch), { clientId: 'c', clientSecret: 's', code: 'k', redirectUri: 'r', codeVerifier: 'v' }, now);
    expect(tokens).toEqual({
      accessToken: 'ghu_a',
      accessExpiresAt: new Date('2026-10-08T02:00:00Z'),
      refreshToken: 'ghr_r',
      refreshExpiresAt: new Date(now.getTime() + 15_811_200_000),
    });
    expect(fetch.calls[0]!.body).toMatchObject({ code: 'k', code_verifier: 'v' });
  });

  it('turns GitHub OAuth errors (sent with status 200) into GithubError', async () => {
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': () => ({ error: 'bad_verification_code' }) });
    await expect(exchangeCode(new GithubClient(fetch), { clientId: 'c', clientSecret: 's', code: 'k', redirectUri: 'r', codeVerifier: 'v' })).rejects.toBeInstanceOf(GithubError);
  });
});
```

`apps/server/src/http/routes/auth.db.test.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ghId } from '../../../test/db';
import { fakeFetch } from '../../../test/fake-fetch';
import { cookieHeader, sessionCookieFor } from '../../../test/http';
import { decrypt } from '../../lib/crypto';
import { prisma } from '../../lib/prisma';
import { pkceChallenge } from '../../auth/github-oauth';
import { GithubClient } from '../../platform/github/client';
import { createApp } from '../app';
import { safeNext } from './auth';

afterEach(() => vi.unstubAllEnvs());

function githubFake(user: { id: string; login: string }) {
  return fakeFetch({
    'POST /login/oauth/access_token': () => ({ access_token: 'ghu_access', expires_in: 28_800, refresh_token: 'ghr_refresh', refresh_token_expires_in: 15_811_200 }),
    'GET /user': () => ({ id: Number(user.id), login: user.login, avatar_url: 'https://avatars.example/u.png' }),
  });
}

/** Start a sign-in and return the cookie plus the state the server saved. */
async function startLogin(app: ReturnType<typeof createApp>, next = '/cli/approve?code=WDJB-MJHT') {
  const res = await app.request(`/auth/github/login?next=${encodeURIComponent(next)}`);
  const cookie = cookieHeader(res);
  const saved = JSON.parse(decrypt(decodeURIComponent(cookie.split(`${BRAND.oauthCookie}=`)[1]!)));
  return { res, cookie, saved };
}

describe('GitHub sign-in', () => {
  it('redirects to GitHub with a PKCE challenge that matches the saved verifier', async () => {
    const app = createApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    const { res, saved } = await startLogin(app);
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get('location')!);
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('code_challenge')).toBe(pkceChallenge(saved.verifier));
    expect(url.searchParams.get('state')).toBe(saved.state);
    expect(saved.next).toBe('/cli/approve?code=WDJB-MJHT');
  });

  it('signs in on the callback: saves the user, encrypts the tokens and starts a session', async () => {
    const githubId = ghId();
    const app = createApp({ github: new GithubClient(githubFake({ id: githubId, login: 'maya' })) });
    const { cookie, saved } = await startLogin(app);

    const res = await app.request(`/auth/github/callback?code=abc&state=${saved.state}`, { headers: { cookie } });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/cli/approve?code=WDJB-MJHT');
    const user = await prisma.user.findUniqueOrThrow({ where: { githubId }, include: { githubAuth: true, sessions: true } });
    expect(user.login).toBe('maya');
    expect(decrypt(user.githubAuth!.accessTokenEnc)).toBe('ghu_access');
    expect(user.githubAuth!.accessTokenEnc).not.toContain('ghu_access');
    expect(user.sessions).toHaveLength(1);
    expect(cookieHeader(res)).toContain(`${BRAND.sessionCookie}=`);
  });

  it('rejects a callback whose state does not match', async () => {
    const app = createApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    const { cookie } = await startLogin(app);
    const res = await app.request('/auth/github/callback?code=abc&state=forged', { headers: { cookie } });
    expect(res.status).toBe(400);
  });

  it('keeps people outside ALLOWED_LOGINS out', async () => {
    vi.stubEnv('ALLOWED_LOGINS', 'leo');
    const app = createApp({ github: new GithubClient(githubFake({ id: ghId(), login: 'maya' })) });
    const { cookie, saved } = await startLogin(app);
    const res = await app.request(`/auth/github/callback?code=abc&state=${saved.state}`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });

  it('signs out only from our own pages', async () => {
    const user = await prisma.user.create({ data: { githubId: ghId(), login: 'maya' } });
    const cookie = await sessionCookieFor(user.id);
    const app = createApp({ github: new GithubClient(fakeFetch({})) });

    expect((await app.request('/auth/logout', { method: 'POST', headers: { cookie } })).status).toBe(403);
    const res = await app.request('/auth/logout', { method: 'POST', headers: { cookie, origin: 'http://localhost:8787' } });
    expect(res.status).toBe(302);
    expect(await prisma.webSession.count({ where: { userId: user.id } })).toBe(0);
  });

  it('shows who is signed in on the home page', async () => {
    const user = await prisma.user.create({ data: { githubId: ghId(), login: 'maya-home' } });
    const app = createApp({ github: new GithubClient(fakeFetch({})) });
    const res = await app.request('/', { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await res.text()).toContain('@maya-home');
  });
});

describe('safeNext', () => {
  it.each([
    ['/cli/approve?code=X', '/cli/approve?code=X'],
    [undefined, '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
  ])('%s → %s', (input, expected) => expect(safeNext(input)).toBe(expected));
});
```

Update `apps/server/src/http/app.test.ts`: change `createApp()` to `createApp({ github: new GithubClient(fakeFetch({})) })`, and add these imports:
```ts
import { fakeFetch } from '../../test/fake-fetch';
import { GithubClient } from '../platform/github/client';
```

- [x] **Step 3: Run the tests to see them fail**

Run: `npm test -w apps/server`
Expected: FAIL, `Failed to resolve import "../platform/github/client"`.

- [x] **Step 4: Write the GitHub client**

`apps/server/src/platform/github/client.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GithubError extends Error {
  constructor(readonly status: number, readonly body: unknown, message: string) {
    super(message);
    this.name = 'GithubError';
  }
}

export type GithubRequest = { token?: string; body?: unknown; headers?: Record<string, string>; accept?: string };
export type GithubResponse<T> = { status: number; data: T; headers: Headers };

/**
 * A small typed wrapper around fetch for GitHub. Tests pass a fake fetch (test/fake-fetch.ts).
 * Statuses below 400 (including 304 Not Modified) are returned; 400+ throw GithubError.
 */
export class GithubClient {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    readonly apiBase = 'https://api.github.com',
    readonly webBase = 'https://github.com',
  ) {}

  async api<T = unknown>(method: string, path: string, opts: GithubRequest = {}): Promise<GithubResponse<T>> {
    const headers: Record<string, string> = {
      accept: opts.accept ?? 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': BRAND.userAgent,
      ...opts.headers,
    };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const data = await readBody(res);
    if (res.status >= 400) throw new GithubError(res.status, data, `GitHub ${method} ${path} failed with ${res.status}`);
    return { status: res.status, data: data as T, headers: res.headers };
  }

  /** POST to github.com/login/oauth/*. GitHub reports OAuth errors as 200 + `{ error }`. */
  async oauth<T>(path: string, params: Record<string, string>): Promise<T> {
    const res = await this.fetchImpl(`${this.webBase}${path}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': BRAND.userAgent },
      body: JSON.stringify(params),
    });
    const data = (await readBody(res)) as (T & { error?: string }) | null;
    if (res.status >= 400 || !data || data.error) {
      throw new GithubError(res.status, data, `GitHub OAuth ${path} failed: ${data?.error ?? res.status}`);
    }
    return data;
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  if ((res.headers.get('content-type') ?? '').includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
```

- [x] **Step 5: Write the OAuth helpers, user saving and sessions**

`apps/server/src/auth/github-oauth.ts`:
```ts
import { createHash } from 'node:crypto';
import type { GithubClient } from '../platform/github/client';

export type OAuthTokens = { accessToken: string; accessExpiresAt: Date; refreshToken: string; refreshExpiresAt: Date };
type TokenResponse = { access_token: string; expires_in: number; refresh_token: string; refresh_token_expires_in: number };

/** PKCE S256: the challenge sent to GitHub is base64url(sha256(verifier)). See docs/why/oauth-pkce.md. */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function authorizeUrl(opts: { webBase: string; clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const url = new URL('/login/oauth/authorize', opts.webBase);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('code_challenge', opts.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCode(
  gh: GithubClient,
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier: string },
  now = new Date(),
): Promise<OAuthTokens> {
  const t = await gh.oauth<TokenResponse>('/login/oauth/access_token', {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  return toTokens(t, now);
}

/** Refresh tokens are single-use: after this call the old one no longer works. */
export async function refreshTokens(
  gh: GithubClient,
  opts: { clientId: string; clientSecret: string; refreshToken: string },
  now = new Date(),
): Promise<OAuthTokens> {
  const t = await gh.oauth<TokenResponse>('/login/oauth/access_token', {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
  });
  return toTokens(t, now);
}

export async function fetchGithubUser(gh: GithubClient, accessToken: string): Promise<{ githubId: string; login: string; avatarUrl: string | null }> {
  const { data } = await gh.api<{ id: number; login: string; avatar_url: string | null }>('GET', '/user', { token: accessToken });
  return { githubId: String(data.id), login: data.login, avatarUrl: data.avatar_url };
}

function toTokens(t: TokenResponse, now: Date): OAuthTokens {
  return {
    accessToken: t.access_token,
    accessExpiresAt: new Date(now.getTime() + t.expires_in * 1000),
    refreshToken: t.refresh_token,
    refreshExpiresAt: new Date(now.getTime() + t.refresh_token_expires_in * 1000),
  };
}
```

`apps/server/src/auth/users.ts`:
```ts
import { encrypt } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import type { OAuthTokens } from './github-oauth';

/** Create or update the user after sign-in, and store their GitHub tokens encrypted. */
export async function saveGithubUser(gh: { githubId: string; login: string; avatarUrl: string | null }, tokens: OAuthTokens) {
  const user = await prisma.user.upsert({
    where: { githubId: gh.githubId },
    create: { githubId: gh.githubId, login: gh.login, avatarUrl: gh.avatarUrl },
    update: { login: gh.login, avatarUrl: gh.avatarUrl },
  });
  const secrets = {
    accessTokenEnc: encrypt(tokens.accessToken),
    accessExpiresAt: tokens.accessExpiresAt,
    refreshTokenEnc: encrypt(tokens.refreshToken),
    refreshExpiresAt: tokens.refreshExpiresAt,
    status: 'ok',
  };
  await prisma.githubAuth.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...secrets },
    update: { ...secrets, version: { increment: 1 } },
  });
  return user;
}
```

`apps/server/src/auth/session.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { hashToken, randomSecret } from '../lib/tokens';

const SESSION_DAYS = 30;

export type SessionUser = { id: string; githubId: string; login: string; avatarUrl: string | null };

export function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    secure: getEnv().PUBLIC_URL.startsWith('https://'),
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/** Sign the browser in: a random token in a cookie, its hash in WebSession. */
export async function startSession(c: Context, userId: string, now = new Date()): Promise<void> {
  const raw = randomSecret();
  await prisma.webSession.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000) } });
  setCookie(c, BRAND.sessionCookie, raw, cookieOptions(SESSION_DAYS * 86_400));
}

export async function currentUser(c: Context, now = new Date()): Promise<SessionUser | null> {
  const raw = getCookie(c, BRAND.sessionCookie);
  if (!raw) return null;
  const session = await prisma.webSession.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: true } });
  if (!session || session.expiresAt <= now) return null;
  const { id, githubId, login, avatarUrl } = session.user;
  return { id, githubId, login, avatarUrl };
}

export async function endSession(c: Context): Promise<void> {
  const raw = getCookie(c, BRAND.sessionCookie);
  if (raw) await prisma.webSession.deleteMany({ where: { tokenHash: hashToken(raw) } });
  deleteCookie(c, BRAND.sessionCookie, { path: '/' });
}
```

- [x] **Step 6: Write the page layout and home page**

`apps/server/src/http/pages/layout.tsx`:
```tsx
/** @jsxImportSource hono/jsx */
import type { Context } from 'hono';
import type { PropsWithChildren } from 'hono/jsx';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Plan 1 pages are deliberately plain. The real design arrives with the web app in Plan 2;
// these colors are the "Soft signal" tokens from the design handoff.
const css = `
:root { --bg:#eef2ee; --surface:#fff; --fg1:#16201b; --fg3:#5f6c65; --b1:#dfe6df; --acc:#16707f; --on-acc:#fff; --code:#f7f9f6; --red:#d6453a; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1412; --surface:#18201c; --fg1:#e8efea; --fg3:#93a198; --b1:#2b3630; --acc:#5cc3d1; --on-acc:#06191c; --code:#121815; --red:#ef5e52; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg1); font:16px/1.5 system-ui, sans-serif; padding:16px; }
.card { width:100%; max-width:440px; background:var(--surface); border:1px solid var(--b1); border-radius:24px; padding:28px; }
h1 { font-size:24px; margin:0 0 8px; letter-spacing:-0.02em; }
.muted { color:var(--fg3); font-size:14px; }
.code { font-family:ui-monospace, monospace; font-size:32px; letter-spacing:0.14em; text-align:center; background:var(--code); border-radius:12px; padding:14px; margin:16px 0; }
.row { display:flex; gap:8px; margin-top:16px; }
button, .button { flex:1; height:44px; border-radius:12px; border:1px solid var(--b1); background:var(--surface); color:var(--fg1); font:inherit; cursor:pointer; text-decoration:none; display:inline-grid; place-items:center; }
.primary { background:var(--acc); border-color:var(--acc); color:var(--on-acc); }
code { font-family:ui-monospace, monospace; background:var(--code); border-radius:6px; padding:1px 6px; }
`;

export function Layout(props: PropsWithChildren<{ title: string }>) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${props.title} · Nitpilot`}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main class="card">{props.children}</main>
      </body>
    </html>
  );
}

/** Send a server-rendered page with a doctype. */
export function renderPage(c: Context, page: { toString(): string }, status: ContentfulStatusCode = 200): Response {
  return c.html(`<!doctype html>${page.toString()}`, status);
}
```

`apps/server/src/http/pages/home.tsx`:
```tsx
/** @jsxImportSource hono/jsx */
import type { SessionUser } from '../../auth/session';
import { Layout } from './layout';

/** Plan 1's only "app" page: who you are and the next onboarding steps (spec §16). */
export function HomePage(props: { user: SessionUser | null; appSlug: string }) {
  if (!props.user) {
    return (
      <Layout title="Sign in">
        <h1>Nitpilot</h1>
        <p class="muted">Your agents review each other's PRs the moment they open. You only hear about it when there's a decision to make.</p>
        <div class="row"><a class="button primary" href="/auth/github/login">Sign in with GitHub →</a></div>
      </Layout>
    );
  }
  return (
    <Layout title="Home">
      <h1>Signed in as @{props.user.login}</h1>
      <ol>
        <li><a href={`https://github.com/apps/${props.appSlug}/installations/new`}>Install the GitHub App</a> on your repos.</li>
        <li>Run <code>npx nitpilot login</code>.</li>
        <li>In your clone, run <code>nitpilot repos add</code>.</li>
        <li>Run <code>nitpilot start</code>.</li>
      </ol>
      <form method="post" action="/auth/logout" class="row"><button type="submit">Sign out</button></form>
    </Layout>
  );
}
```

- [x] **Step 7: Write the sign-in routes and mount them**

`apps/server/src/http/routes/auth.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { authorizeUrl, exchangeCode, fetchGithubUser, pkceChallenge } from '../../auth/github-oauth';
import { cookieOptions, endSession, startSession } from '../../auth/session';
import { saveGithubUser } from '../../auth/users';
import { isAllowedOrigin } from '../../lib/csrf';
import { decrypt, encrypt } from '../../lib/crypto';
import { getEnv } from '../../lib/env';
import { randomSecret } from '../../lib/tokens';
import type { GithubClient } from '../../platform/github/client';
import { HttpError } from '../errors';

const OAuthCookie = z.object({ state: z.string(), verifier: z.string(), next: z.string() });

/** Only same-site paths, so a crafted link can't send people to another site after sign-in. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

function readOAuthCookie(value: string | undefined): z.infer<typeof OAuthCookie> | null {
  if (!value) return null;
  try {
    return OAuthCookie.parse(JSON.parse(decrypt(value)));
  } catch {
    return null;
  }
}

export function authRoutes(deps: { github: GithubClient }): Hono {
  const app = new Hono();

  app.get('/auth/github/login', (c) => {
    const env = getEnv();
    const state = randomSecret(16);
    const verifier = randomSecret(32);
    // The state and verifier travel in an encrypted, short-lived cookie: no table needed.
    setCookie(c, BRAND.oauthCookie, encrypt(JSON.stringify({ state, verifier, next: safeNext(c.req.query('next')) })), cookieOptions(600));
    return c.redirect(
      authorizeUrl({
        webBase: deps.github.webBase,
        clientId: env.GITHUB_CLIENT_ID,
        redirectUri: `${env.PUBLIC_URL}/auth/github/callback`,
        state,
        codeChallenge: pkceChallenge(verifier),
      }),
    );
  });

  app.get('/auth/github/callback', async (c) => {
    const env = getEnv();
    const saved = readOAuthCookie(getCookie(c, BRAND.oauthCookie));
    deleteCookie(c, BRAND.oauthCookie, { path: '/' });
    const code = c.req.query('code');
    if (!saved || !code || c.req.query('state') !== saved.state) {
      throw new HttpError('validation_error', 'This sign-in link expired or was changed. Please sign in again.');
    }

    const tokens = await exchangeCode(deps.github, {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      code,
      redirectUri: `${env.PUBLIC_URL}/auth/github/callback`,
      codeVerifier: saved.verifier,
    });
    const ghUser = await fetchGithubUser(deps.github, tokens.accessToken);
    if (env.ALLOWED_LOGINS.length > 0 && !env.ALLOWED_LOGINS.includes(ghUser.login.toLowerCase())) {
      throw new HttpError('forbidden', 'This Nitpilot instance is invite-only for now.');
    }

    const user = await saveGithubUser(ghUser, tokens);
    await startSession(c, user.id);
    return c.redirect(saved.next);
  });

  app.post('/auth/logout', async (c) => {
    if (!isAllowedOrigin(c.req.raw, getEnv().PUBLIC_URL)) throw new HttpError('forbidden', 'Request did not come from Nitpilot.');
    await endSession(c);
    return c.redirect('/');
  });

  return app;
}
```

Replace `apps/server/src/http/app.ts`:
```ts
import { Hono } from 'hono';
import { currentUser } from '../auth/session';
import { getEnv } from '../lib/env';
import type { GithubClient } from '../platform/github/client';
import { SERVER_VERSION } from '../version';
import { onError } from './errors';
import { HomePage } from './pages/home';
import { renderPage } from './pages/layout';
import { authRoutes } from './routes/auth';

/** What the HTTP layer needs from outside. Tests pass fakes. Later tasks add fields. */
export type AppDeps = { github: GithubClient };

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/healthz', (c) => c.json({ ok: true, version: SERVER_VERSION }));
  app.get('/', async (c) => renderPage(c, HomePage({ user: await currentUser(c), appSlug: getEnv().GITHUB_APP_SLUG })));
  app.route('/', authRoutes(deps));
  return app;
}
```

In `apps/server/src/main.ts`, add `import { GithubClient } from './platform/github/client';` and change `const app = createApp();` to:
```ts
  const github = new GithubClient();
  const app = createApp({ github });
```

- [x] **Step 8: Run the tests to see them pass**

Run: `npm test -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (OAuth 4, sign-in 6, safeNext 5, plus everything earlier).

- [x] **Step 9: Write the explainer**

`docs/why/oauth-pkce.md`:
```markdown
# How "Sign in with GitHub" works (OAuth + PKCE)

**In one sentence:** we send you to GitHub, GitHub sends you back with a one-time code, and our server swaps that code for tokens; PKCE proves the server swapping the code is the one that started the sign-in.

## The steps (`http/routes/auth.ts`)

1. `GET /auth/github/login`: we make two random strings, a **state** and a **verifier**. They go into an encrypted cookie, and you're redirected to GitHub with the state and `sha256(verifier)`, called the **challenge**.
2. You approve on GitHub. GitHub redirects you to `/auth/github/callback?code=…&state=…`.
3. We check that the `state` matches the cookie. This stops another site from starting a sign-in in your browser.
4. We send GitHub the `code` plus the original **verifier**. GitHub hashes the verifier and checks that it matches the challenge from step 1. A stolen `code` alone is useless.
5. GitHub returns an **access token** (8 hours) and a **refresh token** (6 months, single use). We store both encrypted (`lib/crypto.ts`), then set a session cookie.

## Why we keep GitHub tokens at all

Reviews and replies are posted **as you**, so GitHub shows your avatar plus the app badge (spec §15). For that we need your token. When it expires, `auth/user-tokens.ts` refreshes it one refresh at a time, because each refresh token works only once.

## The React analogy

Like a "magic link" login, except the link carries a code that only works together with a secret your own server kept.
```

- [x] **Step 10: Commit**

```bash
git add apps/server docs/why/oauth-pkce.md
git commit -m "feat(server): GitHub sign-in with PKCE, sessions and home page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: User token store with single-flight refresh

**Files:**
- Create: `apps/server/src/auth/user-tokens.ts`, `apps/server/src/auth/user-tokens.db.test.ts`

**Interfaces:**
- Consumes: `GithubClient`, `refreshTokens`, `encrypt`/`decrypt`, `getEnv`, `prisma`.
- Produces: `getUserToken(userId, github, now?) → Promise<string>` and `NeedsReauthError`. Task 26 uses these to post as the user.

Spec §15: access tokens last 8 hours; refresh tokens last 6 months and work once. Refreshes run one at a time per user. If a refresh fails, the user is marked `needs_reauth`, and writes in their name stop; Nitpilot never falls back to posting as the bot.

- [x] **Step 1: Write the failing tests**

`apps/server/src/auth/user-tokens.db.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeUser } from '../../test/db';
import { fakeFetch } from '../../test/fake-fetch';
import { decrypt, encrypt } from '../lib/crypto';
import { prisma } from '../lib/prisma';
import { GithubClient } from '../platform/github/client';
import { getUserToken, NeedsReauthError } from './user-tokens';

const NOW = new Date('2026-10-07T18:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

async function userWithTokens(accessExpiresAt: Date, refreshExpiresAt = minutes(60 * 24 * 30)) {
  const user = await makeUser();
  await prisma.githubAuth.create({
    data: { userId: user.id, accessTokenEnc: encrypt('ghu_old'), accessExpiresAt, refreshTokenEnc: encrypt('ghr_old'), refreshExpiresAt },
  });
  return user;
}

const refreshed = () => ({ access_token: 'ghu_new', expires_in: 28_800, refresh_token: 'ghr_new', refresh_token_expires_in: 15_811_200 });

describe('getUserToken', () => {
  it('returns the stored token while it is fresh, without calling GitHub', async () => {
    const user = await userWithTokens(minutes(60));
    const fetch = fakeFetch({});
    expect(await getUserToken(user.id, new GithubClient(fetch), NOW)).toBe('ghu_old');
    expect(fetch.calls).toHaveLength(0);
  });

  it('refreshes a token that expires within 5 minutes and stores the new pair', async () => {
    const user = await userWithTokens(minutes(3));
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': refreshed });
    expect(await getUserToken(user.id, new GithubClient(fetch), NOW)).toBe('ghu_new');
    const auth = await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } });
    expect(decrypt(auth.refreshTokenEnc)).toBe('ghr_new');
    expect(auth.version).toBe(1);
    expect(fetch.calls[0]!.body).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ghr_old' });
  });

  it('runs only one refresh when several writes need the token at once', async () => {
    const user = await userWithTokens(minutes(1));
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': refreshed });
    const gh = new GithubClient(fetch);
    const tokens = await Promise.all([getUserToken(user.id, gh, NOW), getUserToken(user.id, gh, NOW), getUserToken(user.id, gh, NOW)]);
    expect(tokens).toEqual(['ghu_new', 'ghu_new', 'ghu_new']);
    expect(fetch.calls).toHaveLength(1);
  });

  it('marks the user needs_reauth when GitHub rejects the refresh token, and stops calling GitHub', async () => {
    const user = await userWithTokens(minutes(1));
    const fetch = fakeFetch({ 'POST /login/oauth/access_token': () => ({ error: 'bad_refresh_token' }) });
    const gh = new GithubClient(fetch);
    await expect(getUserToken(user.id, gh, NOW)).rejects.toBeInstanceOf(NeedsReauthError);
    expect((await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe('needs_reauth');
    await expect(getUserToken(user.id, gh, NOW)).rejects.toBeInstanceOf(NeedsReauthError);
    expect(fetch.calls).toHaveLength(1);
  });

  it('marks needs_reauth without calling GitHub when the refresh token itself expired', async () => {
    const user = await userWithTokens(minutes(-10), minutes(-1));
    const fetch = fakeFetch({});
    await expect(getUserToken(user.id, new GithubClient(fetch), NOW)).rejects.toBeInstanceOf(NeedsReauthError);
    expect(fetch.calls).toHaveLength(0);
  });

  it('keeps the user signed in when the network fails', async () => {
    const user = await userWithTokens(minutes(1));
    const gh = new GithubClient(async () => { throw new TypeError('fetch failed'); });
    await expect(getUserToken(user.id, gh, NOW)).rejects.toThrow('fetch failed');
    expect((await prisma.githubAuth.findUniqueOrThrow({ where: { userId: user.id } })).status).toBe('ok');
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm run test:db -w apps/server`
Expected: FAIL, `Failed to resolve import "./user-tokens"`.

- [x] **Step 3: Write the token store**

`apps/server/src/auth/user-tokens.ts`:
```ts
import type { GithubAuth } from '../generated/prisma/client';
import { decrypt, encrypt } from '../lib/crypto';
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import { GithubError, type GithubClient } from '../platform/github/client';
import { refreshTokens, type OAuthTokens } from './github-oauth';

/** The user must sign in with GitHub again before Nitpilot can act as them. */
export class NeedsReauthError extends Error {
  constructor(readonly userId: string) {
    super(`GitHub sign-in expired for user ${userId}`);
    this.name = 'NeedsReauthError';
  }
}

/** Refresh a little early, so a token never expires halfway through a write. */
const REFRESH_MARGIN_MS = 5 * 60_000;

/** One refresh per user at a time: refresh tokens are single-use (spec §15). */
const inFlight = new Map<string, Promise<string>>();

export async function getUserToken(userId: string, github: GithubClient, now = new Date()): Promise<string> {
  const auth = await prisma.githubAuth.findUnique({ where: { userId } });
  if (!auth || auth.status !== 'ok') throw new NeedsReauthError(userId);
  if (auth.accessExpiresAt.getTime() - now.getTime() > REFRESH_MARGIN_MS) return decrypt(auth.accessTokenEnc);

  const running = inFlight.get(userId);
  if (running) return running;
  const refresh = refreshOnce(auth, github, now).finally(() => inFlight.delete(userId));
  inFlight.set(userId, refresh);
  return refresh;
}

async function refreshOnce(auth: GithubAuth, github: GithubClient, now: Date): Promise<string> {
  if (auth.refreshExpiresAt <= now) {
    await markNeedsReauth(auth.id);
    throw new NeedsReauthError(auth.userId);
  }

  const env = getEnv();
  let tokens: OAuthTokens;
  try {
    tokens = await refreshTokens(github, { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, refreshToken: decrypt(auth.refreshTokenEnc) }, now);
  } catch (err) {
    // GitHub answered and said no (e.g. bad_refresh_token): only a new sign-in fixes that.
    if (err instanceof GithubError && err.status < 500) {
      await markNeedsReauth(auth.id);
      throw new NeedsReauthError(auth.userId);
    }
    throw err; // network trouble or a GitHub outage: try again later
  }

  // Save only if nobody refreshed meanwhile (compare-and-swap on `version`).
  const { count } = await prisma.githubAuth.updateMany({
    where: { id: auth.id, version: auth.version },
    data: {
      accessTokenEnc: encrypt(tokens.accessToken),
      accessExpiresAt: tokens.accessExpiresAt,
      refreshTokenEnc: encrypt(tokens.refreshToken),
      refreshExpiresAt: tokens.refreshExpiresAt,
      version: { increment: 1 },
    },
  });
  if (count === 0) {
    const fresh = await prisma.githubAuth.findUniqueOrThrow({ where: { id: auth.id } });
    return decrypt(fresh.accessTokenEnc);
  }
  return tokens.accessToken;
}

async function markNeedsReauth(id: string): Promise<void> {
  await prisma.githubAuth.update({ where: { id }, data: { status: 'needs_reauth' } });
}
```

- [x] **Step 4: Run the tests to see them pass**

Run: `npm run test:db -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (6 token-store tests).

- [x] **Step 5: Commit**

```bash
git add apps/server/src/auth
git commit -m "feat(server): user token store with single-flight refresh and needs_reauth

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: CLI login, approval page and `/api/me`

**Files:**
- Create: `apps/server/src/auth/cli-login.ts`, `apps/server/src/auth/cli-token.ts`, `apps/server/src/lib/urls.ts`, `apps/server/src/http/routes/cli.ts`, `apps/server/src/http/routes/cli-approve.tsx`, `apps/server/src/http/pages/approve.tsx`, `apps/server/src/http/routes/cli.db.test.ts`
- Modify: `apps/server/src/http/app.ts`

**Interfaces:**
- Consumes: `generateToken`, `generateUserCode`, `hashToken`, `parseBearer`, `randomSecret`, `currentUser`, `isAllowedOrigin`, `isUniqueViolation`, and the protocol's `CliLogin*` and `MyChatsResponse`.
- Produces:
  - `startCliLogin(deviceName, now?)`, `pollCliLogin(deviceCode, now?)` and `decideCliLogin(userCode, userId, decision, now?)`;
  - `LOGIN_TTL_MS`, `POLL_INTERVAL_SEC`;
  - `authenticateCliToken(header) → CliAuth | null`, `requireCliToken` middleware and `type CliAuth = { userId, tokenId }` (Plan 1b's WebSocket upgrade reuses `authenticateCliToken`);
  - `transcriptUrl(repoFullName, number)`.
- Routes (spec §10):
  - `POST /api/cli/login` and `POST /api/cli/login/poll`;
  - `GET|POST /cli/approve` (session + Origin check);
  - `GET /api/me`, `GET /api/me/chats` and `DELETE /api/cli/token` (CLI bearer token).

- [x] **Step 1: Write the failing tests**

`apps/server/src/http/routes/cli.db.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { makeChat, makeRepo, makeUser } from '../../../test/db';
import { fakeFetch } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { startCliLogin } from '../../auth/cli-login';
import { prisma } from '../../lib/prisma';
import { generateToken } from '../../lib/tokens';
import { GithubClient } from '../../platform/github/client';
import { createApp } from '../app';

const ORIGIN = { origin: 'http://localhost:8787' };
const app = () => createApp({ github: new GithubClient(fakeFetch({})) });

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app().request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

async function approveForm(code: string, decision: 'approve' | 'deny', cookie: string, headers: Record<string, string> = ORIGIN) {
  return app().request('/cli/approve', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ code, decision }).toString(),
  });
}

describe('nitpilot login', () => {
  it('runs the whole handshake: code, approval in the browser, one token, revoke', async () => {
    const user = await makeUser({ login: 'maya' });
    const cookie = await sessionCookieFor(user.id);

    const start = await (await post('/api/cli/login', { deviceName: "Maya's MacBook Pro" })).json();
    expect(start).toMatchObject({ interval: 2, expiresIn: 600 });
    expect(start.verifyUrl).toBe(`http://localhost:8787/cli/approve?code=${start.userCode}`);
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'pending' });

    const page = await app().request(`/cli/approve?code=${start.userCode}`, { headers: { cookie } });
    const html = await page.text();
    expect(html).toContain(start.userCode);
    expect(html).toContain('Maya&#39;s MacBook Pro');

    expect((await approveForm(start.userCode, 'approve', cookie, {})).status).toBe(403);
    expect(await (await approveForm(start.userCode, 'approve', cookie)).text()).toContain('Device approved');

    const approved = await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json();
    expect(approved.status).toBe('approved');
    expect(approved.token).toMatch(/^nit_/);
    // A token is issued once; later polls never get another.
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'expired' });

    const auth = { authorization: `Bearer ${approved.token}` };
    expect(await (await app().request('/api/me', { headers: auth })).json()).toEqual({ login: 'maya', avatarUrl: null, githubAuth: 'needs_reauth' });
    expect((await app().request('/api/cli/token', { method: 'DELETE', headers: auth })).status).toBe(204);
    expect((await app().request('/api/me', { headers: auth })).status).toBe(401);
  });

  it('reports a denied login', async () => {
    const user = await makeUser();
    const start = await (await post('/api/cli/login', { deviceName: 'laptop' })).json();
    await approveForm(start.userCode, 'deny', await sessionCookieFor(user.id));
    expect(await (await post('/api/cli/login/poll', { deviceCode: start.deviceCode })).json()).toEqual({ status: 'denied' });
  });

  it('expires codes after 10 minutes', async () => {
    const user = await makeUser();
    const old = await startCliLogin('laptop', new Date(Date.now() - 11 * 60_000));
    expect(await (await post('/api/cli/login/poll', { deviceCode: old.deviceCode })).json()).toEqual({ status: 'expired' });
    const page = await app().request(`/cli/approve?code=${old.userCode}`, { headers: { cookie: await sessionCookieFor(user.id) } });
    expect(await page.text()).toContain('This code expired');
  });

  it('sends people who are not signed in to GitHub first, then back', async () => {
    const res = await app().request('/cli/approve?code=WDJB-MJHT');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/auth/github/login?next=${encodeURIComponent('/cli/approve?code=WDJB-MJHT')}`);
  });

  it('rejects a bad request body', async () => {
    expect((await post('/api/cli/login', { deviceName: '' })).status).toBe(400);
  });
});

describe('/api/me/chats', () => {
  it("lists the open chats the CLI's user takes part in", async () => {
    const user = await makeUser();
    const repo = await makeRepo();
    const chat = await makeChat(repo.id, { number: 142 });
    await prisma.participant.create({ data: { chatId: chat.id, githubId: user.githubId, role: 'reviewer', login: user.login, userId: user.id, attention: 'decision' } });
    const closed = await makeChat(repo.id, { number: 143 });
    await prisma.prChat.update({ where: { id: closed.id }, data: { closedAt: new Date(), phase: 'closed' } });
    await prisma.participant.create({ data: { chatId: closed.id, githubId: user.githubId, role: 'reviewer', login: user.login } });

    const t = generateToken();
    await prisma.cliToken.create({ data: { userId: user.id, name: 'laptop', tokenHash: t.hash, prefix: t.prefix } });

    const body = await (await app().request('/api/me/chats', { headers: { authorization: `Bearer ${t.raw}` } })).json();
    expect(body.chats).toEqual([
      expect.objectContaining({ id: chat.id, repo: repo.fullName, number: 142, role: 'reviewer', attention: 'decision', url: `http://localhost:8787/c/${repo.fullName}/142` }),
    ]);
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm run test:db -w apps/server`
Expected: FAIL, `Failed to resolve import "../../auth/cli-login"`.

- [x] **Step 3: Write the login handshake and token check**

`apps/server/src/auth/cli-login.ts`:
```ts
import type { CliLoginPollResponse } from '@nitpilot/protocol';
import { isUniqueViolation, prisma } from '../lib/prisma';
import { generateToken, generateUserCode, hashToken, randomSecret } from '../lib/tokens';

export const LOGIN_TTL_MS = 10 * 60_000;
export const POLL_INTERVAL_SEC = 2;

/** Step 1 of `nitpilot login`: a secret device code for the CLI, and a short code for the person. */
export async function startCliLogin(deviceName: string, now = new Date()) {
  const deviceCode = randomSecret();
  const expiresAt = new Date(now.getTime() + LOGIN_TTL_MS);
  for (let attempt = 0; ; attempt++) {
    const userCode = generateUserCode();
    try {
      await prisma.cliLoginRequest.create({ data: { deviceCodeHash: hashToken(deviceCode), userCode, deviceName, expiresAt } });
      return { deviceCode, userCode, expiresAt };
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 5) continue; // two identical user codes: pick another
      throw err;
    }
  }
}

/** The CLI polls this. The token is created on the first poll after approval and never stored in plain form. */
export async function pollCliLogin(deviceCode: string, now = new Date()): Promise<CliLoginPollResponse> {
  const req = await prisma.cliLoginRequest.findUnique({ where: { deviceCodeHash: hashToken(deviceCode) } });
  if (!req) return { status: 'expired' };
  if (req.status === 'pending' && req.expiresAt <= now) {
    await prisma.cliLoginRequest.update({ where: { id: req.id }, data: { status: 'expired' } });
    return { status: 'expired' };
  }
  if (req.status === 'pending') return { status: 'pending' };
  if (req.status === 'denied') return { status: 'denied' };
  if (req.status !== 'approved' || !req.userId) return { status: 'expired' };

  const userId = req.userId;
  return prisma.$transaction(async (tx) => {
    // Compare-and-swap: only the first poll after approval wins a token.
    const { count } = await tx.cliLoginRequest.updateMany({ where: { id: req.id, status: 'approved' }, data: { status: 'consumed' } });
    if (count === 0) return { status: 'expired' } as const;
    const token = generateToken();
    await tx.cliToken.create({ data: { userId, name: req.deviceName, tokenHash: token.hash, prefix: token.prefix } });
    return { status: 'approved', token: token.raw } as const;
  });
}

export async function findCliLogin(userCode: string) {
  return prisma.cliLoginRequest.findUnique({ where: { userCode: userCode.trim().toUpperCase() } });
}

/** The person pressed Approve or Deny on /cli/approve. */
export async function decideCliLogin(userCode: string, userId: string, decision: 'approve' | 'deny', now = new Date()) {
  const req = await findCliLogin(userCode);
  if (!req) return 'not_found' as const;
  if (req.expiresAt <= now) return 'expired' as const;
  const { count } = await prisma.cliLoginRequest.updateMany({
    where: { id: req.id, status: 'pending' },
    data: { status: decision === 'approve' ? 'approved' : 'denied', userId },
  });
  if (count === 0) return 'expired' as const;
  return decision === 'approve' ? ('approved' as const) : ('denied' as const);
}
```

`apps/server/src/auth/cli-token.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';
import { createMiddleware } from 'hono/factory';
import { prisma } from '../lib/prisma';
import { hashToken, parseBearer } from '../lib/tokens';
import { HttpError } from '../http/errors';

export type CliAuth = { userId: string; tokenId: string };

/** Resolve `Authorization: Bearer nit_…` to its owner, or null (Odyhook's authenticateApiToken). */
export async function authenticateCliToken(header: string | null | undefined, now = new Date()): Promise<CliAuth | null> {
  const raw = parseBearer(header);
  if (!raw || !raw.startsWith(BRAND.tokenPrefix)) return null;
  const token = await prisma.cliToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!token || token.revokedAt) return null;
  // lastSeenAt drives "offline since…" (spec §8).
  await prisma.cliToken.update({ where: { id: token.id }, data: { lastSeenAt: now } });
  return { userId: token.userId, tokenId: token.id };
}

export const requireCliToken = createMiddleware<{ Variables: { cli: CliAuth } }>(async (c, next) => {
  const auth = await authenticateCliToken(c.req.header('authorization'));
  if (!auth) throw new HttpError('unauthorized', `Missing or invalid CLI token. Run \`${BRAND.cli} login\`.`);
  c.set('cli', auth);
  await next();
});
```

`apps/server/src/lib/urls.ts`:
```ts
import { getEnv } from './env';

/** The read-only chat transcript (Plan 1b) and, later, the web app's chat page. */
export function transcriptUrl(repoFullName: string, number: number): string {
  return `${getEnv().PUBLIC_URL}/c/${repoFullName}/${number}`;
}
```

- [x] **Step 4: Write the approval page**

`apps/server/src/http/pages/approve.tsx`:
```tsx
/** @jsxImportSource hono/jsx */
import { BRAND } from '@nitpilot/protocol';
import { Layout } from './layout';

export function ApprovePending(props: { userCode: string; deviceName: string; minutesLeft: number }) {
  return (
    <Layout title="Approve device">
      <p class="muted">Device login</p>
      <h1>Approve this device?</h1>
      <p class="muted">Check that this code matches the one in your terminal.</p>
      <div class="code">{props.userCode}</div>
      <p><strong>{props.deviceName}</strong></p>
      <form method="post" action="/cli/approve">
        <input type="hidden" name="code" value={props.userCode} />
        <div class="row">
          <button class="primary" type="submit" name="decision" value="approve">Approve</button>
          <button type="submit" name="decision" value="deny">Deny</button>
        </div>
      </form>
      <p class="muted">Only approve if you just ran <code>npx {BRAND.npmPackage} login</code>. The code expires in {props.minutesLeft} min.</p>
    </Layout>
  );
}

const RESULT = {
  approved: { title: 'Device approved', body: 'Your terminal is connected. You can close this tab.' },
  denied: { title: 'Login denied', body: 'Nothing was connected. If that was you, run the login command again.' },
  expired: { title: 'This code expired', body: `Codes last 10 minutes. Run npx ${BRAND.npmPackage} login again.` },
  not_found: { title: "This code isn't valid", body: 'Check the code in your terminal, or start the login again.' },
} as const;

export function ApproveResult(props: { outcome: keyof typeof RESULT }) {
  const r = RESULT[props.outcome];
  return (
    <Layout title={r.title}>
      <h1>{r.title}</h1>
      <p class="muted">{r.body}</p>
    </Layout>
  );
}
```

- [x] **Step 5: Write the routes and mount them**

`apps/server/src/http/routes/cli-approve.tsx`:
```tsx
/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { decideCliLogin, findCliLogin } from '../../auth/cli-login';
import { currentUser } from '../../auth/session';
import { isAllowedOrigin } from '../../lib/csrf';
import { getEnv } from '../../lib/env';
import { HttpError } from '../errors';
import { ApprovePending, ApproveResult } from '../pages/approve';
import { renderPage } from '../pages/layout';

export function cliApproveRoutes(): Hono {
  const app = new Hono();

  app.get('/cli/approve', async (c) => {
    const user = await currentUser(c);
    if (!user) {
      const here = new URL(c.req.url);
      return c.redirect(`/auth/github/login?next=${encodeURIComponent(here.pathname + here.search)}`);
    }
    const req = await findCliLogin(c.req.query('code') ?? '');
    if (!req) return renderPage(c, <ApproveResult outcome="not_found" />, 404);
    const msLeft = req.expiresAt.getTime() - Date.now();
    if (req.status !== 'pending' || msLeft <= 0) return renderPage(c, <ApproveResult outcome="expired" />);
    return renderPage(c, <ApprovePending userCode={req.userCode} deviceName={req.deviceName} minutesLeft={Math.ceil(msLeft / 60_000)} />);
  });

  app.post('/cli/approve', async (c) => {
    if (!isAllowedOrigin(c.req.raw, getEnv().PUBLIC_URL)) throw new HttpError('forbidden', 'Request did not come from Nitpilot.');
    const user = await currentUser(c);
    if (!user) throw new HttpError('unauthorized', 'Sign in first.');
    const form = await c.req.parseBody();
    const decision = form['decision'] === 'approve' ? 'approve' : 'deny';
    const outcome = await decideCliLogin(String(form['code'] ?? ''), user.id, decision);
    return renderPage(c, <ApproveResult outcome={outcome} />);
  });

  return app;
}
```

`apps/server/src/http/routes/cli.ts`:
```ts
import {
  CliLoginPollRequest, CliLoginStartRequest, type MeResponse, type MyChat, type MyChatsResponse, type Attention, type Phase, type Role,
} from '@nitpilot/protocol';
import { Hono } from 'hono';
import { LOGIN_TTL_MS, POLL_INTERVAL_SEC, pollCliLogin, startCliLogin } from '../../auth/cli-login';
import { requireCliToken, type CliAuth } from '../../auth/cli-token';
import { getEnv } from '../../lib/env';
import { prisma } from '../../lib/prisma';
import { transcriptUrl } from '../../lib/urls';

export function cliRoutes(): Hono<{ Variables: { cli: CliAuth } }> {
  const app = new Hono<{ Variables: { cli: CliAuth } }>();

  app.post('/api/cli/login', async (c) => {
    const { deviceName } = CliLoginStartRequest.parse(await c.req.json());
    const login = await startCliLogin(deviceName);
    return c.json({
      deviceCode: login.deviceCode,
      userCode: login.userCode,
      verifyUrl: `${getEnv().PUBLIC_URL}/cli/approve?code=${login.userCode}`,
      interval: POLL_INTERVAL_SEC,
      expiresIn: LOGIN_TTL_MS / 1000,
    });
  });

  app.post('/api/cli/login/poll', async (c) => {
    const { deviceCode } = CliLoginPollRequest.parse(await c.req.json());
    return c.json(await pollCliLogin(deviceCode));
  });

  app.get('/api/me', requireCliToken, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('cli').userId }, include: { githubAuth: true } });
    const body: MeResponse = { login: user.login, avatarUrl: user.avatarUrl, githubAuth: user.githubAuth?.status === 'ok' ? 'ok' : 'needs_reauth' };
    return c.json(body);
  });

  app.get('/api/me/chats', requireCliToken, async (c) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.get('cli').userId } });
    const rows = await prisma.participant.findMany({
      where: { githubId: user.githubId, chat: { closedAt: null } },
      include: { chat: { include: { repo: true } } },
      orderBy: { chat: { updatedAt: 'desc' } },
      take: 100,
    });
    const chats: MyChat[] = rows.map((p) => ({
      id: p.chat.id,
      repo: p.chat.repo.fullName,
      number: p.chat.number,
      title: p.chat.title,
      role: p.role as Role,
      phase: p.chat.phase as Phase,
      round: p.chat.round,
      attention: p.attention as Attention,
      url: transcriptUrl(p.chat.repo.fullName, p.chat.number),
      updatedAt: p.chat.updatedAt.toISOString(),
    }));
    const body: MyChatsResponse = { chats };
    return c.json(body);
  });

  app.delete('/api/cli/token', requireCliToken, async (c) => {
    await prisma.cliToken.update({ where: { id: c.get('cli').tokenId }, data: { revokedAt: new Date() } });
    return c.body(null, 204);
  });

  return app;
}
```

In `apps/server/src/http/app.ts`, add the imports and mount both groups after `authRoutes`:
```ts
import { cliRoutes } from './routes/cli';
import { cliApproveRoutes } from './routes/cli-approve';
```
```ts
  app.route('/', cliRoutes());
  app.route('/', cliApproveRoutes());
```

- [x] **Step 6: Run the tests to see them pass**

Run: `npm test -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (6 CLI-login and chats tests, plus everything earlier).

- [x] **Step 7: Try the handshake by hand**

With `npm run dev -w apps/server` running:
```bash
curl -s -X POST localhost:8787/api/cli/login -H 'content-type: application/json' -d '{"deviceName":"test"}'
```
Expected: JSON with `deviceCode`, a `userCode` like `WDJB-MJHT`, and a `verifyUrl`. Opening the `verifyUrl` in a browser redirects to GitHub sign-in. That needs the real dev app credentials in `.env`, which Task 19 sets up.

- [x] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): CLI login handshake, approval page and /api/me

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Milestone M4: Webhooks and the dispatcher

At the end of this milestone, a real GitHub webhook reaches the server, is stored, normalized into a `DomainEvent`, run through `decide`, and saved as chat state, timeline items, jobs and tasks. Nothing is written back to GitHub yet; that's M5.

### Task 18: Webhook ingress

**Files:**
- Create: `apps/server/src/lib/serial-queue.ts`, `apps/server/src/ingest/record.ts`, `apps/server/src/ingest/process.ts`, `apps/server/src/http/routes/webhooks.ts`, `apps/server/src/http/routes/webhooks.db.test.ts`, `apps/server/src/ingest/process.db.test.ts`
- Create: `apps/server/test/app.ts`, `apps/server/test/webhooks.ts`
- Create: `docs/why/webhooks.md`
- Modify: `apps/server/src/http/app.ts`, `apps/server/src/main.ts`, `apps/server/src/http/app.test.ts`, `apps/server/src/http/routes/auth.db.test.ts`, `apps/server/src/http/routes/cli.db.test.ts`

**Interfaces:**
- Consumes: `verifyGithubSignature`, `getEnv`, `HttpError`, `prisma`.
- Produces:
  - `SerialQueue` (`push(job)`, `idle()`);
  - `recordDelivery(row) → boolean` and `purgeOldRows(now?) → { rawEvents, seenComments }`;
  - `DeliveryHandler` and `DeliveryOutcome = { status: 'processed' | 'ignored'; note?: string }`;
  - `processDelivery(deliveryId, handle)`;
  - `createIngest(handle) → Ingest` (`enqueue`, `idle`, `replayReceived`);
  - `AppDeps` gains `ingest: Ingest`;
  - test helpers `testDeps(over)`, `testApp(over)` and `sendWebhook(app, event, payload, opts?)`.
- Route: `POST /webhooks/github` (spec §15 "Handling a webhook").

Deliveries are processed **one at a time, in arrival order** (a `SerialQueue`). That keeps ordering simple and is plenty fast for one server.

- [x] **Step 1: Write the test helpers**

`apps/server/test/app.ts`:
```ts
import { createApp, type AppDeps } from '../src/http/app';
import { createIngest } from '../src/ingest/process';
import { GithubClient } from '../src/platform/github/client';
import { fakeFetch } from './fake-fetch';

/** Everything createApp needs, as harmless fakes. Pass only what a test cares about. */
export function testDeps(over: Partial<AppDeps> = {}): AppDeps {
  return {
    github: new GithubClient(fakeFetch({})),
    ingest: createIngest(async () => ({ status: 'ignored', note: 'test' })),
    ...over,
  };
}

export function testApp(over: Partial<AppDeps> = {}) {
  return createApp(testDeps(over));
}
```

`apps/server/test/webhooks.ts`:
```ts
import type { Hono } from 'hono';
import { getEnv } from '../src/lib/env';
import { signGithubBody } from '../src/lib/hmac';

let n = 0;

/** POST a payload to /webhooks/github exactly as GitHub would: signed, with event and delivery headers. */
export async function sendWebhook(app: Hono, event: string, payload: unknown, opts: { deliveryId?: string; secret?: string } = {}): Promise<Response> {
  const body = JSON.stringify(payload);
  n += 1;
  return app.request('/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': opts.deliveryId ?? `delivery-${Date.now()}-${n}`,
      'x-hub-signature-256': signGithubBody(body, opts.secret ?? getEnv().GITHUB_WEBHOOK_SECRET),
    },
    body,
  });
}
```

In `apps/server/src/http/app.test.ts`, `apps/server/src/http/routes/auth.db.test.ts` and `apps/server/src/http/routes/cli.db.test.ts`, replace every `createApp({ github: X })` with `testApp({ github: X })`. Import it with `import { testApp } from '<relative path>/test/app';` and remove the now-unused `createApp` import. In `auth.db.test.ts`, change the `startLogin` parameter type to `ReturnType<typeof testApp>`.

- [x] **Step 2: Write the failing tests**

`apps/server/src/http/routes/webhooks.db.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { testApp } from '../../../test/app';
import { uid } from '../../../test/db';
import { sendWebhook } from '../../../test/webhooks';
import { createIngest } from '../../ingest/process';
import { prisma } from '../../lib/prisma';

function setup() {
  const handle = vi.fn(async () => ({ status: 'processed' as const }));
  const ingest = createIngest(handle);
  return { app: testApp({ ingest }), ingest, handle };
}

describe('POST /webhooks/github', () => {
  it('stores a signed delivery, answers 202, then processes it', async () => {
    const { app, ingest, handle } = setup();
    const deliveryId = uid('delivery');
    const res = await sendWebhook(app, 'pull_request', { action: 'opened', repository: { id: 501 } }, { deliveryId });
    expect(res.status).toBe(202);

    await ingest.idle();
    expect(handle).toHaveBeenCalledWith({ deliveryId, event: 'pull_request', body: expect.stringContaining('"opened"') });
    expect(await prisma.rawEvent.findUniqueOrThrow({ where: { deliveryId } })).toMatchObject({ event: 'pull_request', action: 'opened', repoId: '501', status: 'processed' });
  });

  it('answers 200 to a redelivery and processes it only once', async () => {
    const { app, ingest, handle } = setup();
    const deliveryId = uid('delivery');
    await sendWebhook(app, 'pull_request', { action: 'opened' }, { deliveryId });
    const again = await sendWebhook(app, 'pull_request', { action: 'opened' }, { deliveryId });
    expect(again.status).toBe(200);
    await ingest.idle();
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('rejects a bad signature and stores nothing', async () => {
    const { app } = setup();
    const deliveryId = uid('delivery');
    const res = await sendWebhook(app, 'pull_request', { action: 'opened' }, { deliveryId, secret: 'wrong' });
    expect(res.status).toBe(401);
    expect(await prisma.rawEvent.findUnique({ where: { deliveryId } })).toBeNull();
  });

  it('rejects a delivery without GitHub headers', async () => {
    const { app } = setup();
    const res = await app.request('/webhooks/github', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  it('rejects bodies over 1 MB', async () => {
    const { app } = setup();
    const res = await sendWebhook(app, 'pull_request', { padding: 'x'.repeat(1024 * 1024) });
    expect(res.status).toBe(413);
  });
});
```

`apps/server/src/ingest/process.db.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb, uid } from '../../test/db';
import { prisma } from '../lib/prisma';
import { createIngest, processDelivery } from './process';
import { purgeOldRows, recordDelivery } from './record';

beforeEach(resetDb);

const row = (deliveryId = uid('delivery')) => ({ deliveryId, event: 'pull_request', action: 'opened', repoId: '501', body: '{"action":"opened"}' });

describe('processDelivery', () => {
  it('records a handler failure on the row instead of throwing', async () => {
    const r = row();
    await recordDelivery(r);
    await processDelivery(r.deliveryId, async () => { throw new Error('GitHub said no'); });
    expect(await prisma.rawEvent.findUniqueOrThrow({ where: { deliveryId: r.deliveryId } })).toMatchObject({ status: 'failed', note: 'GitHub said no' });
  });

  it('marks ignored deliveries with the reason', async () => {
    const r = row();
    await recordDelivery(r);
    await processDelivery(r.deliveryId, async () => ({ status: 'ignored', note: 'nothing to do' }));
    expect(await prisma.rawEvent.findUniqueOrThrow({ where: { deliveryId: r.deliveryId } })).toMatchObject({ status: 'ignored', note: 'nothing to do' });
  });
});

describe('replayReceived', () => {
  it('processes deliveries left as received by a crash, oldest first', async () => {
    const first = row();
    const second = row();
    await recordDelivery(first);
    await recordDelivery(second);
    const seen: string[] = [];
    const ingest = createIngest(async (d) => { seen.push(d.deliveryId); return { status: 'processed' }; });

    expect(await ingest.replayReceived()).toBe(2);
    await ingest.idle();
    expect(seen).toEqual([first.deliveryId, second.deliveryId]);
  });
});

describe('purgeOldRows', () => {
  it('deletes deliveries and seen comments older than 14 days', async () => {
    const old = row();
    await recordDelivery(old);
    await prisma.rawEvent.update({ where: { deliveryId: old.deliveryId }, data: { createdAt: new Date(Date.now() - 15 * 86_400_000) } });
    const fresh = row();
    await recordDelivery(fresh);

    expect(await purgeOldRows()).toEqual({ rawEvents: 1, seenComments: 0 });
    expect(await prisma.rawEvent.count()).toBe(1);
  });
});

describe('createIngest', () => {
  it('runs deliveries one at a time', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const a = row();
    const b = row();
    await recordDelivery(a);
    await recordDelivery(b);
    const ingest = createIngest(async (d) => {
      order.push(`start ${d.deliveryId === a.deliveryId ? 'a' : 'b'}`);
      if (d.deliveryId === a.deliveryId) await gate;
      order.push(`end ${d.deliveryId === a.deliveryId ? 'a' : 'b'}`);
      return { status: 'processed' };
    });
    ingest.enqueue(a.deliveryId);
    ingest.enqueue(b.deliveryId);
    await vi.waitFor(() => expect(order).toEqual(['start a']));
    release();
    await ingest.idle();
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
```

- [x] **Step 3: Run the tests to see them fail**

Run: `npm run test:db -w apps/server`
Expected: FAIL, `Failed to resolve import "../src/ingest/process"`.

- [x] **Step 4: Write the queue, recording and processing**

`apps/server/src/lib/serial-queue.ts`:
```ts
/** Runs async jobs one after another, in the order they were pushed. A failing job doesn't stop the queue. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();

  push(job: () => Promise<void>): void {
    this.tail = this.tail.then(job).catch((err) => console.error('[queue] job failed:', err));
  }

  /** Resolves once every job pushed so far has finished. */
  idle(): Promise<void> {
    return this.tail;
  }
}
```

`apps/server/src/ingest/record.ts`:
```ts
import { prisma } from '../lib/prisma';

export type DeliveryRow = { deliveryId: string; event: string; action: string | null; repoId: string | null; body: string };

/** Store a delivery. Returns false when we already have it (GitHub redelivered it). */
export async function recordDelivery(row: DeliveryRow): Promise<boolean> {
  const { count } = await prisma.rawEvent.createMany({ data: [row], skipDuplicates: true });
  return count === 1;
}

const KEEP_MS = 14 * 86_400_000;

/** Raw deliveries and seen comment ids are kept 14 days (spec §8). */
export async function purgeOldRows(now = new Date()): Promise<{ rawEvents: number; seenComments: number }> {
  const before = new Date(now.getTime() - KEEP_MS);
  const rawEvents = await prisma.rawEvent.deleteMany({ where: { createdAt: { lt: before } } });
  const seenComments = await prisma.seenComment.deleteMany({ where: { createdAt: { lt: before } } });
  return { rawEvents: rawEvents.count, seenComments: seenComments.count };
}
```

`apps/server/src/ingest/process.ts`:
```ts
import { prisma } from '../lib/prisma';
import { SerialQueue } from '../lib/serial-queue';

export type DeliveryOutcome = { status: 'processed' | 'ignored'; note?: string };
export type DeliveryHandler = (d: { deliveryId: string; event: string; body: string }) => Promise<DeliveryOutcome>;

/** Process one stored delivery and record what happened. Never throws. */
export async function processDelivery(deliveryId: string, handle: DeliveryHandler): Promise<void> {
  const row = await prisma.rawEvent.findUnique({ where: { deliveryId } });
  if (!row || row.status !== 'received') return;
  try {
    const outcome = await handle({ deliveryId, event: row.event, body: row.body });
    await prisma.rawEvent.update({ where: { deliveryId }, data: { status: outcome.status, note: outcome.note ?? null } });
  } catch (err) {
    const note = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    console.error(`[ingest] delivery ${deliveryId} (${row.event}) failed:`, err);
    await prisma.rawEvent.update({ where: { deliveryId }, data: { status: 'failed', note } });
  }
}

export type Ingest = {
  /** Process a stored delivery soon, after any earlier ones. */
  enqueue(deliveryId: string): void;
  /** Resolves when everything enqueued so far is done (tests use this). */
  idle(): Promise<void>;
  /** After a crash: enqueue every delivery still marked `received`. Returns how many. */
  replayReceived(): Promise<number>;
};

export function createIngest(handle: DeliveryHandler): Ingest {
  const queue = new SerialQueue();
  const enqueue = (deliveryId: string) => queue.push(() => processDelivery(deliveryId, handle));
  return {
    enqueue,
    idle: () => queue.idle(),
    async replayReceived() {
      const rows = await prisma.rawEvent.findMany({ where: { status: 'received' }, orderBy: { createdAt: 'asc' }, select: { deliveryId: true } });
      for (const r of rows) enqueue(r.deliveryId);
      return rows.length;
    },
  };
}
```

- [x] **Step 5: Write the webhook route and mount it**

`apps/server/src/http/routes/webhooks.ts`:
```ts
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getEnv } from '../../lib/env';
import { verifyGithubSignature } from '../../lib/hmac';
import type { Ingest } from '../../ingest/process';
import { recordDelivery } from '../../ingest/record';
import { errorBody, HttpError } from '../errors';

const MAX_BODY_BYTES = 1024 * 1024;

/**
 * GitHub's webhook endpoint (spec §15): check the signature on the raw body, store the
 * delivery once, answer 202 at once, and process it afterwards. See docs/why/webhooks.md.
 */
export function webhookRoutes(deps: { ingest: Ingest }): Hono {
  const app = new Hono();

  app.post(
    '/webhooks/github',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(errorBody('payload_too_large', 'webhook body over 1 MB'), 413) }),
    async (c) => {
      const raw = await c.req.text();
      if (!verifyGithubSignature(raw, c.req.header('x-hub-signature-256'), getEnv().GITHUB_WEBHOOK_SECRET)) {
        throw new HttpError('unauthorized', 'bad webhook signature');
      }
      const deliveryId = c.req.header('x-github-delivery');
      const event = c.req.header('x-github-event');
      if (!deliveryId || !event) throw new HttpError('validation_error', 'missing X-GitHub-Delivery or X-GitHub-Event');

      let payload: { action?: string; repository?: { id?: number } };
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new HttpError('validation_error', 'webhook body is not JSON');
      }

      const isNew = await recordDelivery({
        deliveryId,
        event,
        action: payload.action ?? null,
        repoId: payload.repository?.id != null ? String(payload.repository.id) : null,
        body: raw,
      });
      if (!isNew) return c.text('duplicate delivery', 200);
      deps.ingest.enqueue(deliveryId);
      return c.text('accepted', 202);
    },
  );

  return app;
}
```

In `apps/server/src/http/app.ts`:
- Change `AppDeps` to `export type AppDeps = { github: GithubClient; ingest: Ingest };` and add `import type { Ingest } from '../ingest/process';`.
- Add `import { webhookRoutes } from './routes/webhooks';` and `app.route('/', webhookRoutes(deps));` after the other routes.

In `apps/server/src/main.ts`:
- Add the imports `import { createIngest } from './ingest/process';` and `import { purgeOldRows } from './ingest/record';`.
- Replace `const app = createApp({ github });` with:
```ts
  // Until Task 23 the server stores deliveries but has nothing to do with them yet.
  const ingest = createIngest(async (d) => ({ status: 'ignored', note: `no handler for ${d.event} yet` }));
  const app = createApp({ github, ingest });
```
- After `serve(...)`, add:
```ts
  await ingest.replayReceived();
  const purge = setInterval(() => void purgeOldRows().catch((err) => console.error('[purge]', err)), 60 * 60_000);
```
- Add `clearInterval(purge);` as the first line of `shutdown`.

- [x] **Step 6: Run the tests to see them pass**

Run: `npm test -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (webhook route 5, ingest 5, plus everything earlier).

- [x] **Step 7: Write the explainer**

`docs/why/webhooks.md`:
```markdown
# Webhooks: how GitHub tells us something happened

**In one sentence:** instead of us asking GitHub "anything new?" every few seconds (polling), GitHub sends an HTTP POST to `/webhooks/github` the moment something happens.

## What arrives

Every delivery has a JSON body (the PR, the comment, …) and headers:
- `X-GitHub-Event`: what kind of thing happened (`pull_request`, `issue_comment`, …);
- `X-GitHub-Delivery`: a unique id for this delivery;
- `X-Hub-Signature-256`: an HMAC, a fingerprint of the body made with a secret only GitHub and we know.

## What we do with it (`http/routes/webhooks.ts`)

1. **Check the signature** on the exact raw bytes. Anyone on the internet can POST to our URL; only GitHub can make a valid fingerprint. The comparison is constant-time (`lib/hmac.ts`), so attackers can't learn the right answer byte by byte from response times.
2. **Store it** as a `RawEvent` row, keyed by the delivery id. GitHub sometimes sends the same delivery twice; the second insert is skipped, so nothing happens twice.
3. **Answer 202 right away.** GitHub gives up after 10 seconds, so we never make it wait for our work.
4. **Process it afterwards**, one delivery at a time, in order (`ingest/process.ts`). If the server crashes first, the row is still `received`, and boot replays it.

## The React analogy

It's the difference between `setInterval(fetchUpdates, 5000)` and a WebSocket push: the server tells you instead of you asking. The signature check is like validating a JWT before trusting its claims.
```

- [x] **Step 8: Commit**

```bash
git add apps/server docs/why/webhooks.md
git commit -m "feat(server): webhook ingress with HMAC, dedupe and serial processing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 19: Platform types, GitHub App auth, reads and the dev tunnel

**Files:**
- Create: `apps/server/src/platform/types.ts`, `apps/server/src/platform/github/payloads.ts`, `apps/server/src/platform/github/app-auth.ts`, `apps/server/src/platform/github/app-auth.test.ts`, `apps/server/src/platform/github/mapping.ts`, `apps/server/src/platform/github/reads.ts`, `apps/server/src/platform/github/reads.test.ts`
- Create: `apps/server/scripts/dev-tunnel.ts`
- Modify: `apps/server/package.json`, `package.json` (script `dev:tunnel`)

**Interfaces:**
- Consumes: `GithubClient`, `GithubError`, engine `Person`/`DomainEvent`.
- Produces:
  - `platform/types.ts`: `PrRef`, `RepoRef`, `PrSnapshot`, `GitSpec`, `AnchoredComment`, `RepoInfo`, `NormalizedEvent`, `PrNormalizedEvent`, `PlatformReads`, `PlatformWrites`, `WriteOptions`, `PlatformAdapter = PlatformReads & PlatformWrites`;
  - `payloads.ts`: GitHub payload types (`GhUser`, `GhRepo`, `GhPull`, `GhReviewComment`, `GhPullRequestEvent`, `GhReviewCommentEvent`, `GhReviewEvent`, `GhReviewThreadEvent`, `GhIssueCommentEvent`, `GhInstallationEvent`, `GhInstallationReposEvent`, `GhRepositoryEvent`);
  - `app-auth.ts`: `createAppJwt(appId, pem, now?)` and `AppAuth` (`jwt()`, `installationToken(id)`);
  - `mapping.ts` (pure helpers, imported by the normalizers too): `toPerson`, `isTrustedAssociation`, `snapshotFromPull`, `gitSpecFor`;
  - `reads.ts`: `class GithubReads` (`getPr`, `readDefaultBranchFile`, `gitSpec`; Task 21 adds `parseWebhook`). It re-exports the `mapping.ts` helpers for convenience.

The adapter interface is spec §12.1, with three adjustments:
1. It's split into `PlatformReads` (used by the router, Tasks 19–23) and `PlatformWrites` (Task 26), so the server can be wired before writes exist.
2. Writes take an optional `{ reuseIfContains }`: on a retry, the adapter first looks for an earlier write containing that marker (Review Focus #2).
3. `verifyWebhook` and `deliveryId` are left out: the GitHub route checks HMAC itself (Task 18), and they come back with a second platform. `findOpenPrsFor` and `listThreads` come in Plan 1b (catch-up).

- [x] **Step 1: Write the types**

`apps/server/src/platform/types.ts`:
```ts
import type { DomainEvent, Person } from '../engine/types';

/** Which PR, on which installation. All ids are strings (spec §8). */
export type PrRef = { installationId: string; repoId: string; repoFullName: string; number: number };
export type RepoRef = Omit<PrRef, 'number'>;

/** What the server needs to know about a PR. */
export type PrSnapshot = {
  ref: PrRef;
  title: string;
  body: string;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  isDraft: boolean;
  author: Person;
  /** GitHub's author_association: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE, … */
  authorAssociation: string;
  requestedReviewers: Person[];
  headSha: string;
  baseSha: string;
  headRef: string;
  baseRef: string;
  /** null when the PR came from a fork that has been deleted */
  headRepoFullName: string | null;
};

/** How the CLI fetches the code (spec §11). `headRepoPath` null = nowhere to push. */
export type GitSpec = { baseCloneUrl: string; fetchRef: string; headRepoPath: string | null; headBranch: string };

export type AnchoredComment = {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
  diffRefs: { base: string; head: string; start?: string };
};

export type RepoInfo = { id: string; fullName: string; private: boolean; defaultBranch: string };

export type PrNormalizedEvent = {
  scope: 'pr';
  pr: PrRef;
  /** Set when the webhook carried the full PR (pull_request events); otherwise null. */
  snapshot: PrSnapshot | null;
  event: DomainEvent;
};

export type NormalizedEvent =
  | PrNormalizedEvent
  | { scope: 'installation'; action: 'created' | 'deleted' | 'suspend' | 'unsuspend'; installationId: string; accountLogin: string; repos: RepoInfo[] }
  | { scope: 'installation_repos'; installationId: string; accountLogin: string; added: RepoInfo[]; removed: string[] }
  | { scope: 'repo'; action: 'privatized' | 'publicized' | 'deleted' | 'renamed'; installationId: string; repo: RepoInfo };

/** Reading from a code platform (spec §12.1). */
export interface PlatformReads {
  readonly id: 'github' | 'gitlab';
  /** [] means "nothing for us here". May call the platform's API. */
  parseWebhook(h: Headers, raw: string): Promise<NormalizedEvent[]>;
  getPr(pr: PrRef): Promise<PrSnapshot>;
  readDefaultBranchFile(repo: RepoRef, path: string, etag?: string): Promise<{ text: string; etag: string } | 'not_modified' | null>;
  gitSpec(pr: PrSnapshot): GitSpec;
}

/** On a retry, first look for an earlier write whose body contains this marker, and reuse it. */
export type WriteOptions = { reuseIfContains?: string };

/** Writing to a code platform (spec §12.1). */
export interface PlatformWrites {
  /** The summary comment, as the app bot. */
  upsertSummary(pr: PrRef, body: string, existingId?: string, opts?: WriteOptions): Promise<{ id: string }>;
  /** One review (COMMENT), as the user `asUser` (a Nitpilot user id). */
  postReview(asUser: string, pr: PrRef, r: { commitSha: string; body: string; comments: AnchoredComment[] }, opts?: WriteOptions): Promise<{ reviewId: string; commentIds: string[] }>;
  /** A reply in a comment thread, as the user. */
  replyToThread(asUser: string, pr: PrRef, threadRootId: string, body: string, opts?: WriteOptions): Promise<{ id: string }>;
  redeliverFailed?(since: Date): Promise<number>;
}

export type PlatformAdapter = PlatformReads & PlatformWrites;
```

`apps/server/src/platform/github/payloads.ts`:
```ts
// The parts of GitHub's payloads that Nitpilot reads. GitHub sends much more; we ignore the rest.

export type GhUser = { id: number; login: string; type?: string };
export type GhRepo = { id: number; full_name: string; private: boolean; default_branch?: string };

export type GhPull = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  merged?: boolean;
  user: GhUser;
  author_association: string;
  requested_reviewers?: GhUser[];
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  base: { sha: string; ref: string; repo: GhRepo };
};

export type GhReviewComment = {
  id: number;
  in_reply_to_id?: number;
  user: GhUser;
  author_association: string;
  body: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  side?: 'LEFT' | 'RIGHT' | null;
  commit_id?: string;
};

type Envelope = { installation: { id: number }; repository: GhRepo; sender: GhUser };

export type GhPullRequestEvent = Envelope & {
  action: string;
  number: number;
  pull_request: GhPull;
  requested_reviewer?: GhUser;
  requested_team?: { slug: string };
  before?: string;
  after?: string;
};
export type GhReviewCommentEvent = Envelope & { action: string; comment: GhReviewComment; pull_request: GhPull };
export type GhReviewEvent = Envelope & {
  action: string;
  review: { id: number; user: GhUser; author_association: string; state: string; body: string | null };
  pull_request: GhPull;
};
export type GhReviewThreadEvent = Envelope & { action: string; thread: { comments: GhReviewComment[] }; pull_request: GhPull };
export type GhIssueCommentEvent = Envelope & {
  action: string;
  issue: { number: number; pull_request?: { url: string } };
  comment: { id: number; user: GhUser; author_association: string; body: string };
};
export type GhInstallationEvent = { action: string; installation: { id: number; account: { login: string } }; repositories?: GhRepo[] };
export type GhInstallationReposEvent = {
  action: string;
  installation: { id: number; account: { login: string } };
  repositories_added: GhRepo[];
  repositories_removed: GhRepo[];
};
export type GhRepositoryEvent = Envelope & { action: string };
```

- [x] **Step 2: Write the failing tests**

`apps/server/src/platform/github/app-auth.test.ts`:
```ts
import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../../test/fake-fetch';
import { AppAuth, createAppJwt } from './app-auth';
import { GithubClient } from './client';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const NOW = new Date('2026-10-07T18:00:00Z');

describe('createAppJwt', () => {
  it('signs an RS256 JWT for the app, valid for 9 minutes, backdated 60 s for clock drift', () => {
    const jwt = createAppJwt('12345', pem, NOW);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const iat = NOW.getTime() / 1000 - 60;
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual({ iat, exp: iat + 540, iss: '12345' });
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
});

describe('AppAuth.installationToken', () => {
  it('fetches a token once and reuses it until 5 minutes before it expires', async () => {
    let now = NOW;
    const fetch = fakeFetch({
      'POST /app/installations/77/access_tokens': () => ({ token: `ghs_${fetch.calls.length}`, expires_at: new Date(now.getTime() + 60 * 60_000).toISOString() }),
    });
    const auth = new AppAuth(new GithubClient(fetch), '12345', pem, () => now);

    expect(await auth.installationToken('77')).toBe('ghs_1');
    expect(await auth.installationToken('77')).toBe('ghs_1');
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.headers.get('authorization')).toMatch(/^Bearer ey/);

    now = new Date(NOW.getTime() + 56 * 60_000);
    expect(await auth.installationToken('77')).toBe('ghs_2');
  });
});
```

`apps/server/src/platform/github/reads.test.ts`:
```ts
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { AppAuth } from './app-auth';
import { GithubClient } from './client';
import type { GhPull } from './payloads';
import { GithubReads, gitSpecFor, isTrustedAssociation, snapshotFromPull } from './reads';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };

const pull: GhPull = {
  number: 42,
  title: 'Cursor pagination',
  body: null,
  html_url: 'https://github.com/octo/sandbox/pull/42',
  state: 'open',
  draft: false,
  merged: false,
  user: { id: 1001, login: 'maya', type: 'User' },
  author_association: 'OWNER',
  requested_reviewers: [{ id: 1002, login: 'leo', type: 'User' }],
  head: { sha: 'a'.repeat(40), ref: 'feature/cursor', repo: { full_name: 'maya/sandbox-fork' } },
  base: { sha: 'b'.repeat(40), ref: 'main', repo: { id: 501, full_name: 'octo/sandbox', private: false } },
};

function reads(routes: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch({ 'POST /app/installations/77/access_tokens': () => ({ token: 'ghs_x', expires_at: '2099-01-01T00:00:00Z' }), ...routes });
  const github = new GithubClient(fetch);
  return { fetch, platform: new GithubReads(github, new AppAuth(github, '12345', pem)) };
}

describe('snapshotFromPull', () => {
  it('maps a PR, keeping ids as strings', () => {
    expect(snapshotFromPull(ref, pull)).toEqual({
      ref,
      title: 'Cursor pagination',
      body: '',
      url: 'https://github.com/octo/sandbox/pull/42',
      state: 'open',
      merged: false,
      isDraft: false,
      author: { githubId: '1001', login: 'maya', isBot: false, userId: null },
      authorAssociation: 'OWNER',
      requestedReviewers: [{ githubId: '1002', login: 'leo', isBot: false, userId: null }],
      headSha: 'a'.repeat(40),
      baseSha: 'b'.repeat(40),
      headRef: 'feature/cursor',
      baseRef: 'main',
      headRepoFullName: 'maya/sandbox-fork',
    });
  });

  it('handles a PR whose fork was deleted (Review Focus #5)', () => {
    const snap = snapshotFromPull(ref, { ...pull, head: { ...pull.head, repo: null } });
    expect(snap.headRepoFullName).toBeNull();
    expect(gitSpecFor(snap)).toEqual({ baseCloneUrl: 'https://github.com/octo/sandbox.git', fetchRef: 'refs/pull/42/head', headRepoPath: null, headBranch: 'feature/cursor' });
  });

  it('fetches from the base repo even for a fork, so fork PRs work', () => {
    expect(gitSpecFor(snapshotFromPull(ref, pull))).toMatchObject({ baseCloneUrl: 'https://github.com/octo/sandbox.git', headRepoPath: 'maya/sandbox-fork' });
  });
});

describe('isTrustedAssociation', () => {
  it.each<[string, boolean]>([['OWNER', true], ['MEMBER', true], ['COLLABORATOR', true], ['CONTRIBUTOR', false], ['FIRST_TIME_CONTRIBUTOR', false], ['NONE', false]])('%s → %s', (a, expected) => {
    expect(isTrustedAssociation(a)).toBe(expected);
  });
});

describe('GithubReads', () => {
  it('reads a PR with an installation token', async () => {
    const { platform, fetch } = reads({ 'GET /repos/octo/sandbox/pulls/42': () => pull });
    expect((await platform.getPr(ref)).title).toBe('Cursor pagination');
    expect(fetch.calls.at(-1)!.headers.get('authorization')).toBe('Bearer ghs_x');
  });

  it('reads .nitpilot.yml with an ETag and understands 304 and 404', async () => {
    let status = 200;
    const { platform, fetch } = reads({
      'GET /repos/octo/sandbox/contents/.nitpilot.yml': () =>
        status === 200 ? new Response('max_rounds: 2\n', { status: 200, headers: { etag: '"abc"', 'content-type': 'application/vnd.github.raw' } }) : json(null, status),
    });
    const repo = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox' };

    expect(await platform.readDefaultBranchFile(repo, '.nitpilot.yml')).toEqual({ text: 'max_rounds: 2\n', etag: '"abc"' });
    status = 304;
    expect(await platform.readDefaultBranchFile(repo, '.nitpilot.yml', '"abc"')).toBe('not_modified');
    expect(fetch.calls.at(-1)!.headers.get('if-none-match')).toBe('"abc"');
    status = 404;
    expect(await platform.readDefaultBranchFile(repo, '.nitpilot.yml')).toBeNull();
  });
});
```

- [x] **Step 3: Run the tests to see them fail**

Run: `npm run test:unit -w apps/server`
Expected: FAIL, `Failed to resolve import "./app-auth"` and `"./reads"`.

- [x] **Step 4: Write the app auth**

`apps/server/src/platform/github/app-auth.ts`:
```ts
import { createSign } from 'node:crypto';
import type { GithubClient } from './client';

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * A GitHub App proves who it is with a short-lived JWT signed by its private key.
 * Backdated 60 s because GitHub allows that much clock drift; valid for 9 minutes (max 10).
 */
export function createAppJwt(appId: string, privateKeyPem: string, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iat, exp: iat + 9 * 60, iss: appId })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem).toString('base64url');
  return `${unsigned}.${signature}`;
}

/** App-level credentials: the JWT, and per-installation tokens (1 hour) used to act as the app bot. */
export class AppAuth {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly github: GithubClient,
    private readonly appId: string,
    private readonly privateKeyPem: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  jwt(): string {
    return createAppJwt(this.appId, this.privateKeyPem, this.now());
  }

  async installationToken(installationId: string): Promise<string> {
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAt - this.now().getTime() > 5 * 60_000) return cached.token;
    const { data } = await this.github.api<{ token: string; expires_at: string }>('POST', `/app/installations/${installationId}/access_tokens`, { token: this.jwt() });
    this.cache.set(installationId, { token: data.token, expiresAt: new Date(data.expires_at).getTime() });
    return data.token;
  }
}
```

- [x] **Step 5: Write the mapping helpers and the reads**

`apps/server/src/platform/github/mapping.ts`:
```ts
import type { Person } from '../../engine/types';
import type { GitSpec, PrRef, PrSnapshot } from '../types';
import type { GhPull, GhUser } from './payloads';

// Pure helpers that turn GitHub's shapes into ours. No I/O, so the normalizers can use them too.

/** A GitHub user as the engine sees them. The router fills in `userId` later. */
export function toPerson(u: GhUser): Person {
  return { githubId: String(u.id), login: u.login, isBot: u.type === 'Bot', userId: null };
}

/** Trusted = OWNER, MEMBER or COLLABORATOR of the repo (spec §6.1). Trusted bots are added by the router. */
export function isTrustedAssociation(association: string | undefined): boolean {
  return association === 'OWNER' || association === 'MEMBER' || association === 'COLLABORATOR';
}

export function snapshotFromPull(ref: PrRef, pull: GhPull): PrSnapshot {
  return {
    ref,
    title: pull.title,
    body: pull.body ?? '',
    url: pull.html_url,
    state: pull.state,
    merged: pull.merged === true,
    isDraft: pull.draft === true,
    author: toPerson(pull.user),
    authorAssociation: pull.author_association,
    requestedReviewers: (pull.requested_reviewers ?? []).map(toPerson),
    headSha: pull.head.sha,
    baseSha: pull.base.sha,
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
    headRepoFullName: pull.head.repo?.full_name ?? null,
  };
}

/** Fetch PR code from the base repo's `refs/pull/N/head`, which works for forks too (spec §11). */
export function gitSpecFor(pr: PrSnapshot): GitSpec {
  return {
    baseCloneUrl: `https://github.com/${pr.ref.repoFullName}.git`,
    fetchRef: `refs/pull/${pr.ref.number}/head`,
    headRepoPath: pr.headRepoFullName,
    headBranch: pr.headRef,
  };
}
```

`apps/server/src/platform/github/reads.ts`:
```ts
import type { GitSpec, PrRef, PrSnapshot, RepoRef } from '../types';
import type { AppAuth } from './app-auth';
import { GithubError, type GithubClient } from './client';
import { gitSpecFor, snapshotFromPull } from './mapping';
import type { GhPull } from './payloads';

export { gitSpecFor, isTrustedAssociation, snapshotFromPull, toPerson } from './mapping';

/** The read side of the GitHub adapter. Task 21 adds parseWebhook; Task 26 adds the writes. */
export class GithubReads {
  readonly id = 'github' as const;

  constructor(
    protected readonly github: GithubClient,
    protected readonly appAuth: AppAuth,
  ) {}

  async getPr(ref: PrRef): Promise<PrSnapshot> {
    const token = await this.appAuth.installationToken(ref.installationId);
    const { data } = await this.github.api<GhPull>('GET', `/repos/${ref.repoFullName}/pulls/${ref.number}`, { token });
    return snapshotFromPull(ref, data);
  }

  /** Read a file from the default branch. `etag` makes an unchanged file cost nothing (304). */
  async readDefaultBranchFile(repo: RepoRef, path: string, etag?: string): Promise<{ text: string; etag: string } | 'not_modified' | null> {
    const token = await this.appAuth.installationToken(repo.installationId);
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    try {
      const res = await this.github.api<unknown>('GET', `/repos/${repo.repoFullName}/contents/${encoded}`, {
        token,
        accept: 'application/vnd.github.raw+json',
        headers: etag ? { 'if-none-match': etag } : {},
      });
      if (res.status === 304) return 'not_modified';
      const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '');
      return { text, etag: res.headers.get('etag') ?? '' };
    } catch (err) {
      if (err instanceof GithubError && err.status === 404) return null;
      throw err;
    }
  }

  gitSpec(pr: PrSnapshot): GitSpec {
    return gitSpecFor(pr);
  }
}
```

- [x] **Step 6: Run the tests to see them pass**

Run: `npm run test:unit -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (app auth 2, reads 11).

- [x] **Step 7: Create the dev GitHub App (manual, once)**

On GitHub: Settings → Developer settings → GitHub Apps → **New GitHub App**.
- **Name:** `nitpilot-dev` (add a suffix if the name is taken, and put it in `GITHUB_APP_SLUG`).
- **Homepage URL:** `http://localhost:8787`.
- **Callback URL:** `http://localhost:8787/auth/github/callback`. Tick **Expire user authorization tokens**.
- Leave **Request user authorization (OAuth) during installation** unticked. When it's ticked, GitHub ignores the Setup URL and sends people to the Callback URL after installing, without the `state` our sign-in started, so the callback rejects them.
- **Setup URL:** `http://localhost:8787/github/setup`. Tick **Redirect on update**.
- **Webhook:** Active. The URL can be anything for now (`npm run dev:tunnel` sets it). **Secret:** run `openssl rand -hex 32`.
- **Repository permissions:** Pull requests *Read and write*, Issues *Read*, Contents *Read*, Metadata *Read* (spec §15).
- **Subscribe to events:** Pull request, Pull request review, Pull request review comment, Pull request review thread, Issue comment, Repository.
- **Where can this GitHub App be installed:** Any account (you'll test with two accounts).

After creating it, put these into `apps/server/.env`:
- the App ID and Client ID;
- a new client secret;
- the webhook secret;
- a new private key, as `GITHUB_APP_PRIVATE_KEY` on one line with `\n` for line breaks: `awk 'NF {printf "%s\\n", $0}' key.pem`.

- [x] **Step 8: Write the dev tunnel script**

`apps/server/scripts/dev-tunnel.ts`:
```ts
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { getEnv } from '../src/lib/env';
import { AppAuth } from '../src/platform/github/app-auth';
import { GithubClient } from '../src/platform/github/client';

// Expose the local server through a free Cloudflare quick tunnel (no account needed) and point the
// GitHub App's webhook URL at it (spec §17). Requests arrive byte for byte, so the HMAC check runs
// exactly as in production. Needs `cloudflared` (macOS: brew install cloudflared).

const env = getEnv();
const github = new GithubClient();
const auth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${env.PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });

let pointed = false;
async function onOutput(chunk: Buffer): Promise<void> {
  process.stderr.write(chunk);
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
  if (!match || pointed) return;
  pointed = true;
  const url = `${match[0]}/webhooks/github`;
  await github.api('PATCH', '/app/hook/config', { token: auth.jwt(), body: { url, content_type: 'json', secret: env.GITHUB_WEBHOOK_SECRET } });
  console.log(`\n✓ ${env.GITHUB_APP_SLUG} now sends webhooks to ${url}\n  Leave this running. Ctrl-C stops the tunnel.\n`);
}

tunnel.stdout.on('data', (c: Buffer) => void onOutput(c).catch((err) => console.error(err)));
tunnel.stderr.on('data', (c: Buffer) => void onOutput(c).catch((err) => console.error(err)));
tunnel.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => tunnel.kill('SIGINT'));
```

Add to `apps/server/package.json` `"scripts"`: `"dev:tunnel": "tsx scripts/dev-tunnel.ts"`.
Add to the root `package.json` `"scripts"`: `"dev:tunnel": "npm run dev:tunnel -w apps/server"`.

- [x] **Step 9: Try the tunnel**

Run `npm run dev -w apps/server` in one terminal and `npm run dev:tunnel` in another.
Expected: a `https://….trycloudflare.com` URL, then `✓ nitpilot-dev now sends webhooks to …/webhooks/github`. In the app's **Advanced** tab on GitHub, "Redeliver" the ping: the dev server logs a 202, and a `RawEvent` row appears with status `ignored` ("no handler for ping yet").

- [x] **Step 10: Commit**

```bash
git add apps/server package.json
git commit -m "feat(server): platform types, GitHub App auth, PR reads and dev tunnel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 20: Normalize pull request events

**Files:**
- Create: `apps/server/test/fixtures/github.ts`, `apps/server/src/platform/github/normalize/pull-request.ts`, `apps/server/src/platform/github/normalize/pull-request.test.ts`

**Interfaces:**
- Consumes: `snapshotFromPull` and `toPerson` (from `mapping.ts`), payload types.
- Produces:
  - `prRefFrom(payload, number)` and `normalizePullRequest(payload) → NormalizedEvent[]`;
  - test fixtures: `people`, `repository`, `installation`, `pull()`, `prEvent()`, `reviewComment()`, `reviewCommentEvent()`, `reviewEvent()`, `threadEvent()`, `issueCommentEvent()`, `installationEvent()`, `installationReposEvent()` and `repositoryEvent()`.

The fixtures are typed builders shaped like GitHub's documented payloads, trimmed to the fields we read. Plan 1b's live acceptance checks them against real deliveries.

- [x] **Step 1: Write the fixtures**

`apps/server/test/fixtures/github.ts`:
```ts
import type {
  GhInstallationEvent, GhInstallationReposEvent, GhIssueCommentEvent, GhPull, GhPullRequestEvent, GhRepo, GhRepositoryEvent,
  GhReviewComment, GhReviewCommentEvent, GhReviewEvent, GhReviewThreadEvent, GhUser,
} from '../../src/platform/github/payloads';

// GitHub-shaped payloads for tests. Fixed ids: DB tests that use them call resetDb() first.

export const people = {
  maya: { id: 1001, login: 'maya', type: 'User' },
  leo: { id: 1002, login: 'leo', type: 'User' },
  sam: { id: 1003, login: 'sam', type: 'User' },
  rabbit: { id: 1004, login: 'coderabbitai[bot]', type: 'Bot' },
  bot: { id: 1005, login: 'nitpilot-dev[bot]', type: 'Bot' },
} satisfies Record<string, GhUser>;

export const repository: GhRepo = { id: 501, full_name: 'octo/sandbox', private: false, default_branch: 'main' };
export const installation = { id: 77 };
const envelope = { installation, repository, sender: people.maya };

export function pull(over: Partial<GhPull> = {}): GhPull {
  return {
    number: 42,
    title: 'Cursor pagination for orders',
    body: 'Replaces offset pagination.',
    html_url: 'https://github.com/octo/sandbox/pull/42',
    state: 'open',
    draft: false,
    merged: false,
    user: people.maya,
    author_association: 'OWNER',
    requested_reviewers: [people.leo],
    head: { sha: 'a'.repeat(40), ref: 'feature/cursor-pagination', repo: { full_name: 'octo/sandbox' } },
    base: { sha: 'b'.repeat(40), ref: 'main', repo: repository },
    ...over,
  };
}

export function prEvent(
  action: string,
  opts: { pull?: Partial<GhPull>; requested_reviewer?: GhUser; requested_team?: { slug: string }; before?: string; after?: string } = {},
): GhPullRequestEvent {
  const { pull: pullOver, ...rest } = opts;
  const pr = pull(pullOver);
  return { ...envelope, action, number: pr.number, pull_request: pr, ...rest };
}

export function reviewComment(over: Partial<GhReviewComment> = {}): GhReviewComment {
  return {
    id: 9001,
    user: people.sam,
    author_association: 'COLLABORATOR',
    body: 'Please handle the empty list.',
    path: 'src/orders/list.ts',
    line: 48,
    side: 'RIGHT',
    commit_id: 'a'.repeat(40),
    ...over,
  };
}

export function reviewCommentEvent(action: string, comment: GhReviewComment = reviewComment()): GhReviewCommentEvent {
  return { ...envelope, action, comment, pull_request: pull() };
}

export function reviewEvent(state: string, opts: { id?: number; user?: GhUser; body?: string | null; association?: string; action?: string } = {}): GhReviewEvent {
  return {
    ...envelope,
    action: opts.action ?? 'submitted',
    review: { id: opts.id ?? 7001, user: opts.user ?? people.sam, author_association: opts.association ?? 'COLLABORATOR', state, body: opts.body ?? null },
    pull_request: pull(),
  };
}

export function threadEvent(action: 'resolved' | 'unresolved', rootCommentId = 9001): GhReviewThreadEvent {
  return { ...envelope, action, thread: { comments: [reviewComment({ id: rootCommentId }), reviewComment({ id: rootCommentId + 1, in_reply_to_id: rootCommentId })] }, pull_request: pull() };
}

export function issueCommentEvent(action: string, opts: { id?: number; user?: GhUser; body?: string; association?: string; onPr?: boolean } = {}): GhIssueCommentEvent {
  return {
    ...envelope,
    action,
    issue: { number: 42, ...(opts.onPr === false ? {} : { pull_request: { url: 'https://api.github.com/repos/octo/sandbox/pulls/42' } }) },
    comment: { id: opts.id ?? 8001, user: opts.user ?? people.sam, author_association: opts.association ?? 'COLLABORATOR', body: opts.body ?? 'Could this use a cursor type?' },
  };
}

export function installationEvent(action: string, repos: GhRepo[] = [repository]): GhInstallationEvent {
  return { action, installation: { id: installation.id, account: { login: 'octo' } }, repositories: repos };
}

export function installationReposEvent(added: GhRepo[], removed: GhRepo[]): GhInstallationReposEvent {
  return { action: added.length ? 'added' : 'removed', installation: { id: installation.id, account: { login: 'octo' } }, repositories_added: added, repositories_removed: removed };
}

export function repositoryEvent(action: string, repo: GhRepo = repository): GhRepositoryEvent {
  return { action, installation, repository: repo, sender: people.maya };
}
```

- [x] **Step 2: Write the failing test**

`apps/server/src/platform/github/normalize/pull-request.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { people, prEvent } from '../../../../test/fixtures/github';
import { normalizePullRequest } from './pull-request';

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };
const maya = { githubId: '1001', login: 'maya', isBot: false, userId: null };
const leo = { githubId: '1002', login: 'leo', isBot: false, userId: null };

describe('normalizePullRequest', () => {
  it('turns opened into pr_opened with the author, the requested reviewers and a snapshot', () => {
    const [ne] = normalizePullRequest(prEvent('opened'));
    expect(ne).toMatchObject({ scope: 'pr', pr: ref, event: { type: 'pr_opened', author: maya, reviewers: [leo] } });
    expect(ne!.scope === 'pr' && ne!.snapshot?.headSha).toBe('a'.repeat(40));
  });

  it.each([
    ['reopened', { type: 'pr_reopened' }],
    ['ready_for_review', { type: 'pr_ready' }],
    ['converted_to_draft', { type: 'pr_to_draft' }],
  ] as const)('maps %s', (action, event) => {
    expect(normalizePullRequest(prEvent(action))[0]).toMatchObject({ event });
  });

  it('tells merged and closed apart', () => {
    expect(normalizePullRequest(prEvent('closed', { pull: { state: 'closed', merged: true } }))[0]).toMatchObject({ event: { type: 'pr_closed', merged: true } });
    expect(normalizePullRequest(prEvent('closed', { pull: { state: 'closed', merged: false } }))[0]).toMatchObject({ event: { type: 'pr_closed', merged: false } });
  });

  it('maps a review request for a person, and ignores team requests (v1)', () => {
    expect(normalizePullRequest(prEvent('review_requested', { requested_reviewer: people.leo }))[0]).toMatchObject({ event: { type: 'review_requested', reviewer: leo } });
    expect(normalizePullRequest(prEvent('review_requested', { requested_team: { slug: 'backend' } }))).toEqual([]);
    expect(normalizePullRequest(prEvent('review_request_removed', { requested_reviewer: people.leo }))[0]).toMatchObject({ event: { type: 'review_request_removed', reviewer: leo } });
  });

  it('turns synchronize into head_updated; the router decides whether the push was ours', () => {
    expect(normalizePullRequest(prEvent('synchronize', { before: 'a'.repeat(40), after: 'c'.repeat(40) }))[0]).toMatchObject({
      event: { type: 'head_updated', before: 'a'.repeat(40), after: 'c'.repeat(40), ours: false },
    });
  });

  it('marks bots', () => {
    const [ne] = normalizePullRequest(prEvent('opened', { pull: { user: people.rabbit } }));
    expect(ne).toMatchObject({ event: { author: { login: 'coderabbitai[bot]', isBot: true } } });
  });

  it('keeps a PR from a deleted fork (Review Focus #5)', () => {
    const [ne] = normalizePullRequest(prEvent('opened', { pull: { head: { sha: 'a'.repeat(40), ref: 'patch-1', repo: null } } }));
    expect(ne!.scope === 'pr' && ne!.snapshot?.headRepoFullName).toBeNull();
  });

  it.each(['edited', 'labeled', 'assigned', 'auto_merge_enabled'])('ignores %s', (action) => {
    expect(normalizePullRequest(prEvent(action))).toEqual([]);
  });
});
```

- [x] **Step 3: Run the test to see it fail**

Run: `npm run test:unit -w apps/server -- src/platform/github/normalize`
Expected: FAIL, `Failed to resolve import "./pull-request"`.

- [x] **Step 4: Write the normalizer**

`apps/server/src/platform/github/normalize/pull-request.ts`:
```ts
import type { DomainEvent } from '../../../engine/types';
import type { NormalizedEvent, PrRef } from '../../types';
import type { GhPullRequestEvent } from '../payloads';
import { snapshotFromPull, toPerson } from '../mapping';

/** The PrRef for any event that has `installation` and `repository`. */
export function prRefFrom(payload: { installation: { id: number }; repository: { id: number; full_name: string } }, number: number): PrRef {
  return {
    installationId: String(payload.installation.id),
    repoId: String(payload.repository.id),
    repoFullName: payload.repository.full_name,
    number,
  };
}

/** `pull_request` webhooks → domain events (spec §9 DomainEvent). */
export function normalizePullRequest(p: GhPullRequestEvent): NormalizedEvent[] {
  const ref = prRefFrom(p, p.pull_request.number);
  const snapshot = snapshotFromPull(ref, p.pull_request);
  const one = (event: DomainEvent): NormalizedEvent[] => [{ scope: 'pr', pr: ref, snapshot, event }];

  switch (p.action) {
    case 'opened':
      return one({ type: 'pr_opened', author: snapshot.author, reviewers: snapshot.requestedReviewers });
    case 'reopened':
      return one({ type: 'pr_reopened' });
    case 'ready_for_review':
      return one({ type: 'pr_ready' });
    case 'converted_to_draft':
      return one({ type: 'pr_to_draft' });
    case 'closed':
      return one({ type: 'pr_closed', merged: p.pull_request.merged === true });
    case 'review_requested':
      // Team review requests are out of scope for v1 (spec §18).
      return p.requested_reviewer ? one({ type: 'review_requested', reviewer: toPerson(p.requested_reviewer) }) : [];
    case 'review_request_removed':
      return p.requested_reviewer ? one({ type: 'review_request_removed', reviewer: toPerson(p.requested_reviewer) }) : [];
    case 'synchronize':
      return one({ type: 'head_updated', before: p.before ?? '', after: p.after ?? p.pull_request.head.sha, ours: false });
    default:
      return [];
  }
}
```

- [x] **Step 5: Run the test to see it pass**

Run: `npm run test:unit -w apps/server -- src/platform/github/normalize && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (13 tests).

- [x] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): normalize GitHub pull_request webhooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 21: Normalize comments, reviews and threads; parseWebhook; FakePlatform

**Files:**
- Create: `apps/server/src/platform/github/normalize/comments.ts`, `apps/server/src/platform/github/normalize/comments.test.ts`, `apps/server/src/platform/github/normalize/index.ts`, `apps/server/src/platform/fake/fake-platform.ts`, `apps/server/src/platform/fake/fake-platform.test.ts`
- Modify: `apps/server/src/platform/github/reads.ts` (add `parseWebhook`, `reviewComments`; declare `implements PlatformReads`)

**Interfaces:**
- Consumes: `prRefFrom`, `normalizePullRequest`, and `toPerson`/`isTrustedAssociation`/`gitSpecFor` from `mapping.ts`.
- Produces:
  - `commentFromReviewComment(c) → ExternalComment`, `normalizeReviewComment`, `normalizeReview(p, fetchComments)`, `normalizeReviewThread` and `normalizeIssueComment`;
  - `parseGithubWebhook(event, raw, fetchReviewComments) → Promise<NormalizedEvent[]>` and `type FetchReviewComments`;
  - `GithubReads.parseWebhook`;
  - `FakePlatform`, a full `PlatformAdapter` in memory: it parses real GitHub-shaped payloads and records writes in `.writes` (`FakeWrite`). Tests from here on use it.
- Id conventions (used by every later task):
  - review comments keep GitHub's numeric id as a string;
  - PR conversation comments are `issue:<id>`;
  - a review body is `review:<id>`.

Spec §15: a submitted review's comments are fetched through the API instead of trusting the order the webhooks arrive in (Review Focus #3).

- [x] **Step 1: Write the failing tests**

`apps/server/src/platform/github/normalize/comments.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { issueCommentEvent, people, reviewComment, reviewCommentEvent, reviewEvent, threadEvent } from '../../../../test/fixtures/github';
import { commentFromReviewComment, normalizeIssueComment, normalizeReview, normalizeReviewComment, normalizeReviewThread } from './comments';
import { parseGithubWebhook } from './index';

const sam = { githubId: '1003', login: 'sam', isBot: false, userId: null };

describe('review comments', () => {
  it('maps a new top-level comment, keeping the path exactly (Review Focus #5)', () => {
    const c = commentFromReviewComment(reviewComment({ path: 'src/ordres été/list v2.ts' }));
    expect(c).toEqual({ id: '9001', threadRootId: null, author: sam, trusted: true, body: 'Please handle the empty list.', path: 'src/ordres été/list v2.ts', line: 48, side: 'RIGHT', commitSha: 'a'.repeat(40) });
  });

  it('maps a reply to its thread root', () => {
    expect(commentFromReviewComment(reviewComment({ id: 9002, in_reply_to_id: 9001 })).threadRootId).toBe('9001');
  });

  it('uses original_line for an outdated comment', () => {
    expect(commentFromReviewComment(reviewComment({ line: null, original_line: 40 })).line).toBe(40);
  });

  it('is untrusted for outside contributors', () => {
    expect(commentFromReviewComment(reviewComment({ author_association: 'CONTRIBUTOR' })).trusted).toBe(false);
  });

  it('turns created and deleted into events and ignores edits', () => {
    expect(normalizeReviewComment(reviewCommentEvent('created'))[0]).toMatchObject({ scope: 'pr', snapshot: null, event: { type: 'external_comment', comment: { id: '9001' } } });
    expect(normalizeReviewComment(reviewCommentEvent('deleted'))[0]).toMatchObject({ event: { type: 'external_comment_deleted', commentId: '9001' } });
    expect(normalizeReviewComment(reviewCommentEvent('edited'))).toEqual([]);
  });
});

describe('submitted reviews', () => {
  it("fetch the review's own comments through the API (Review Focus #3)", async () => {
    const fetchComments = vi.fn(async () => [reviewComment({ id: 9101 }), reviewComment({ id: 9102 })]);
    const [ne] = await normalizeReview(reviewEvent('CHANGES_REQUESTED', { body: 'Needs work.' }), fetchComments);
    expect(fetchComments).toHaveBeenCalledWith({ installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 }, '7001');
    expect(ne).toMatchObject({
      event: { type: 'external_review_submitted', review: { id: '7001', author: sam, trusted: true, state: 'changes_requested', body: 'Needs work.', comments: [{ id: '9101' }, { id: '9102' }] } },
    });
  });

  it.each(['DISMISSED', 'PENDING'])('ignore a %s review', async (state) => {
    expect(await normalizeReview(reviewEvent(state), async () => [])).toEqual([]);
  });

  it('ignore review edits', async () => {
    expect(await normalizeReview(reviewEvent('COMMENTED', { action: 'edited' }), async () => [])).toEqual([]);
  });
});

describe('threads and conversation comments', () => {
  it('map resolved and unresolved threads to their root comment', () => {
    expect(normalizeReviewThread(threadEvent('resolved', 9001))[0]).toMatchObject({ event: { type: 'thread_resolved', threadRootId: '9001' } });
    expect(normalizeReviewThread(threadEvent('unresolved', 9001))[0]).toMatchObject({ event: { type: 'thread_unresolved', threadRootId: '9001' } });
  });

  it('map a PR conversation comment with an issue: id', () => {
    expect(normalizeIssueComment(issueCommentEvent('created'))[0]).toMatchObject({
      pr: { number: 42 },
      event: { type: 'external_comment', comment: { id: 'issue:8001', threadRootId: null, path: null, line: null } },
    });
    expect(normalizeIssueComment(issueCommentEvent('deleted'))[0]).toMatchObject({ event: { type: 'external_comment_deleted', commentId: 'issue:8001' } });
  });

  it('ignore comments on plain issues', () => {
    expect(normalizeIssueComment(issueCommentEvent('created', { onPr: false }))).toEqual([]);
  });
});

describe('parseGithubWebhook', () => {
  it('routes by event name and ignores events it does not use', async () => {
    const raw = JSON.stringify(reviewCommentEvent('created', reviewComment({ user: people.rabbit, author_association: 'NONE' })));
    const [ne] = await parseGithubWebhook('pull_request_review_comment', raw, async () => []);
    expect(ne).toMatchObject({ event: { comment: { author: { isBot: true }, trusted: false } } });
    expect(await parseGithubWebhook('ping', '{"zen":"hi"}', async () => [])).toEqual([]);
  });
});
```

`apps/server/src/platform/fake/fake-platform.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { prEvent, reviewComment, reviewEvent } from '../../../test/fixtures/github';
import { FakePlatform } from './fake-platform';

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };
const headers = (event: string) => new Headers({ 'x-github-event': event });

describe('FakePlatform', () => {
  it('parses real GitHub payloads, with review comments from its own store', async () => {
    const fake = new FakePlatform();
    fake.reviewComments.set('7001', [reviewComment({ id: 9101 })]);
    const [ne] = await fake.parseWebhook(headers('pull_request_review'), JSON.stringify(reviewEvent('COMMENTED', { id: 7001 })));
    expect(ne).toMatchObject({ event: { review: { comments: [{ id: '9101' }] } } });
    expect((await fake.parseWebhook(headers('pull_request'), JSON.stringify(prEvent('opened'))))[0]).toMatchObject({ event: { type: 'pr_opened' } });
  });

  it('keeps one summary per PR and edits it in place', async () => {
    const fake = new FakePlatform();
    const { id } = await fake.upsertSummary(ref, 'v1');
    await fake.upsertSummary(ref, 'v2', id);
    expect(fake.writesFor(ref, 'summary')).toEqual([expect.objectContaining({ id, body: 'v2', edits: 1 })]);
  });

  it('reuses an earlier write that carries the marker instead of writing twice', async () => {
    const fake = new FakePlatform();
    const first = await fake.postReview('user-leo', ref, { commitSha: 'a', body: 'review <!-- m1 -->', comments: [] });
    const again = await fake.postReview('user-leo', ref, { commitSha: 'a', body: 'review <!-- m1 -->', comments: [] }, { reuseIfContains: '<!-- m1 -->' });
    expect(again.reviewId).toBe(first.reviewId);
    expect(fake.writesFor(ref, 'review')).toHaveLength(1);
  });

  it('serves PRs and files it was given', async () => {
    const fake = new FakePlatform();
    fake.files.set('octo/sandbox:.nitpilot.yml', 'max_rounds: 2\n');
    const first = await fake.readDefaultBranchFile(ref, '.nitpilot.yml');
    expect(first).toEqual({ text: 'max_rounds: 2\n', etag: expect.any(String) });
    expect(await fake.readDefaultBranchFile(ref, '.nitpilot.yml', (first as { etag: string }).etag)).toBe('not_modified');
    await expect(fake.getPr(ref)).rejects.toThrow(/no PR/);
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm run test:unit -w apps/server -- src/platform`
Expected: FAIL, `Failed to resolve import "./comments"` and `"./fake-platform"`.

- [x] **Step 3: Write the comment normalizers**

`apps/server/src/platform/github/normalize/comments.ts`:
```ts
import type { ExternalComment } from '../../../engine/types';
import type { NormalizedEvent, PrRef } from '../../types';
import type { GhIssueCommentEvent, GhReviewComment, GhReviewCommentEvent, GhReviewEvent, GhReviewThreadEvent } from '../payloads';
import { isTrustedAssociation, toPerson } from '../mapping';
import { prRefFrom } from './pull-request';

export type FetchReviewComments = (ref: PrRef, reviewId: string) => Promise<GhReviewComment[]>;

export function commentFromReviewComment(c: GhReviewComment): ExternalComment {
  return {
    id: String(c.id),
    threadRootId: c.in_reply_to_id ? String(c.in_reply_to_id) : null,
    author: toPerson(c.user),
    trusted: isTrustedAssociation(c.author_association),
    body: c.body,
    path: c.path ?? null,
    line: c.line ?? c.original_line ?? null,
    side: c.side ?? null,
    commitSha: c.commit_id ?? null,
  };
}

export function normalizeReviewComment(p: GhReviewCommentEvent): NormalizedEvent[] {
  const pr = prRefFrom(p, p.pull_request.number);
  if (p.action === 'created') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'external_comment', comment: commentFromReviewComment(p.comment) } }];
  if (p.action === 'deleted') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'external_comment_deleted', commentId: String(p.comment.id) } }];
  return [];
}

const REVIEW_STATES = { approved: 'approved', changes_requested: 'changes_requested', commented: 'commented' } as const;

/** A submitted review, with its comments fetched through the API so webhook order doesn't matter. */
export async function normalizeReview(p: GhReviewEvent, fetchComments: FetchReviewComments): Promise<NormalizedEvent[]> {
  if (p.action !== 'submitted') return [];
  const state = REVIEW_STATES[p.review.state.toLowerCase() as keyof typeof REVIEW_STATES];
  if (!state) return []; // dismissed, pending
  const pr = prRefFrom(p, p.pull_request.number);
  const reviewId = String(p.review.id);
  const comments = (await fetchComments(pr, reviewId)).map(commentFromReviewComment);
  return [
    {
      scope: 'pr',
      pr,
      snapshot: null,
      event: {
        type: 'external_review_submitted',
        review: {
          id: reviewId,
          author: toPerson(p.review.user),
          trusted: isTrustedAssociation(p.review.author_association),
          state,
          body: p.review.body ?? '',
          comments,
        },
      },
    },
  ];
}

export function normalizeReviewThread(p: GhReviewThreadEvent): NormalizedEvent[] {
  const root = p.thread.comments[0];
  if (!root) return [];
  const pr = prRefFrom(p, p.pull_request.number);
  const threadRootId = String(root.id);
  if (p.action === 'resolved') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'thread_resolved', threadRootId } }];
  if (p.action === 'unresolved') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'thread_unresolved', threadRootId } }];
  return [];
}

/** A comment in the PR's conversation tab. GitHub models PRs as issues, hence `issue_comment`. */
export function normalizeIssueComment(p: GhIssueCommentEvent): NormalizedEvent[] {
  if (!p.issue.pull_request) return []; // a plain issue, not a PR
  const pr = prRefFrom(p, p.issue.number);
  const id = `issue:${p.comment.id}`;
  if (p.action === 'deleted') return [{ scope: 'pr', pr, snapshot: null, event: { type: 'external_comment_deleted', commentId: id } }];
  if (p.action !== 'created') return [];
  const comment: ExternalComment = {
    id,
    threadRootId: null,
    author: toPerson(p.comment.user),
    trusted: isTrustedAssociation(p.comment.author_association),
    body: p.comment.body,
    path: null,
    line: null,
    side: null,
    commitSha: null,
  };
  return [{ scope: 'pr', pr, snapshot: null, event: { type: 'external_comment', comment } }];
}
```

`apps/server/src/platform/github/normalize/index.ts`:
```ts
import type { NormalizedEvent } from '../../types';
import { normalizeIssueComment, normalizeReview, normalizeReviewComment, normalizeReviewThread, type FetchReviewComments } from './comments';
import { normalizePullRequest } from './pull-request';

export type { FetchReviewComments };

/** Turn one GitHub delivery into normalized events. `[]` means "nothing for us". */
export async function parseGithubWebhook(event: string, raw: string, fetchReviewComments: FetchReviewComments): Promise<NormalizedEvent[]> {
  const payload = JSON.parse(raw);
  switch (event) {
    case 'pull_request':
      return normalizePullRequest(payload);
    case 'pull_request_review_comment':
      return normalizeReviewComment(payload);
    case 'pull_request_review':
      return normalizeReview(payload, fetchReviewComments);
    case 'pull_request_review_thread':
      return normalizeReviewThread(payload);
    case 'issue_comment':
      return normalizeIssueComment(payload);
    default:
      return [];
  }
}
```

- [x] **Step 4: Add `parseWebhook` to `GithubReads`**

In `apps/server/src/platform/github/reads.ts`:
- Add the imports `import type { NormalizedEvent, PlatformReads } from '../types';` (merge into the existing `../types` import), `import { parseGithubWebhook } from './normalize/index';`, and add `GhReviewComment` to the `./payloads` import.
- Change the class line to `export class GithubReads implements PlatformReads {`.
- Add these methods:
```ts
  async parseWebhook(h: Headers, raw: string): Promise<NormalizedEvent[]> {
    return parseGithubWebhook(h.get('x-github-event') ?? '', raw, (ref, reviewId) => this.reviewComments(ref, reviewId));
  }

  /** The comments that belong to one submitted review. */
  async reviewComments(ref: PrRef, reviewId: string): Promise<GhReviewComment[]> {
    const token = await this.appAuth.installationToken(ref.installationId);
    const { data } = await this.github.api<GhReviewComment[]>('GET', `/repos/${ref.repoFullName}/pulls/${ref.number}/reviews/${reviewId}/comments?per_page=100`, { token });
    return data;
  }
```

- [x] **Step 5: Write `FakePlatform`**

`apps/server/src/platform/fake/fake-platform.ts`:
```ts
import { GithubError } from '../github/client';
import { parseGithubWebhook } from '../github/normalize/index';
import type { GhReviewComment } from '../github/payloads';
import { gitSpecFor } from '../github/mapping';
import type { AnchoredComment, GitSpec, NormalizedEvent, PlatformAdapter, PrRef, PrSnapshot, RepoRef, WriteOptions } from '../types';

export type FakeWrite = {
  kind: 'summary' | 'review' | 'reply';
  id: string;
  pr: PrRef;
  asUser: string | null;
  body: string;
  edits: number;
  comments: AnchoredComment[];
  commentIds: string[];
  threadRootId: string | null;
};

const prKey = (pr: PrRef) => `${pr.repoFullName}#${pr.number}`;

/**
 * GitHub in memory, for tests (spec §19 "FakePlatform"). It parses real GitHub-shaped payloads,
 * serves PRs and files that tests put in, and records every write in `writes`.
 */
export class FakePlatform implements PlatformAdapter {
  readonly id = 'github' as const;
  readonly prs = new Map<string, PrSnapshot>();
  /** `${repoFullName}:${path}` → file text on the default branch */
  readonly files = new Map<string, string>();
  /** review id → that review's comments, for parseWebhook */
  readonly reviewComments = new Map<string, GhReviewComment[]>();
  readonly writes: FakeWrite[] = [];
  /** Make the next postReview with inline comments fail like GitHub does for lines outside the diff. */
  rejectNextInlineReview = false;
  private nextId = Date.now() * 1000;

  addPr(snapshot: PrSnapshot): void {
    this.prs.set(prKey(snapshot.ref), snapshot);
  }

  writesFor(pr: PrRef, kind: FakeWrite['kind']): FakeWrite[] {
    return this.writes.filter((w) => w.kind === kind && prKey(w.pr) === prKey(pr));
  }

  async parseWebhook(h: Headers, raw: string): Promise<NormalizedEvent[]> {
    return parseGithubWebhook(h.get('x-github-event') ?? '', raw, async (_ref, reviewId) => this.reviewComments.get(reviewId) ?? []);
  }

  async getPr(pr: PrRef): Promise<PrSnapshot> {
    const snapshot = this.prs.get(prKey(pr));
    if (!snapshot) throw new Error(`FakePlatform: no PR ${prKey(pr)}`);
    return snapshot;
  }

  async readDefaultBranchFile(repo: RepoRef, path: string, etag?: string): Promise<{ text: string; etag: string } | 'not_modified' | null> {
    const text = this.files.get(`${repo.repoFullName}:${path}`);
    if (text === undefined) return null;
    const current = `fake-etag-${text.length}`;
    return etag === current ? 'not_modified' : { text, etag: current };
  }

  gitSpec(pr: PrSnapshot): GitSpec {
    return gitSpecFor(pr);
  }

  async upsertSummary(pr: PrRef, body: string, existingId?: string, opts?: WriteOptions): Promise<{ id: string }> {
    const existing =
      this.writes.find((w) => w.kind === 'summary' && w.id === existingId) ??
      (opts?.reuseIfContains ? this.find('summary', pr, opts.reuseIfContains) : undefined);
    if (existing) {
      existing.body = body;
      existing.edits += 1;
      return { id: existing.id };
    }
    return { id: this.record({ kind: 'summary', pr, asUser: null, body }).id };
  }

  async postReview(asUser: string, pr: PrRef, r: { commitSha: string; body: string; comments: AnchoredComment[] }, opts?: WriteOptions): Promise<{ reviewId: string; commentIds: string[] }> {
    const reused = opts?.reuseIfContains ? this.find('review', pr, opts.reuseIfContains) : undefined;
    if (reused) return { reviewId: reused.id, commentIds: reused.commentIds };
    if (this.rejectNextInlineReview && r.comments.length > 0) {
      this.rejectNextInlineReview = false;
      throw new GithubError(422, { message: 'Line could not be resolved' }, 'GitHub POST reviews failed with 422');
    }
    const commentIds = r.comments.map(() => String(this.nextId++));
    const w = this.record({ kind: 'review', pr, asUser, body: r.body, comments: r.comments, commentIds });
    return { reviewId: w.id, commentIds };
  }

  async replyToThread(asUser: string, pr: PrRef, threadRootId: string, body: string, opts?: WriteOptions): Promise<{ id: string }> {
    const reused = opts?.reuseIfContains ? this.find('reply', pr, opts.reuseIfContains) : undefined;
    if (reused) return { id: reused.id };
    return { id: this.record({ kind: 'reply', pr, asUser, body, threadRootId }).id };
  }

  async redeliverFailed(): Promise<number> {
    return 0;
  }

  private find(kind: FakeWrite['kind'], pr: PrRef, marker: string): FakeWrite | undefined {
    return this.writes.find((w) => w.kind === kind && prKey(w.pr) === prKey(pr) && w.body.includes(marker));
  }

  private record(w: Pick<FakeWrite, 'kind' | 'pr' | 'asUser' | 'body'> & Partial<FakeWrite>): FakeWrite {
    const write: FakeWrite = { id: String(this.nextId++), edits: 0, comments: [], commentIds: [], threadRootId: null, ...w };
    this.writes.push(write);
    return write;
  }
}
```

- [x] **Step 6: Run the tests to see them pass**

Run: `npm run test:unit -w apps/server -- src/platform && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (comment normalizers 14, FakePlatform 4, plus the earlier platform tests).

- [x] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): normalize comments, reviews and threads; FakePlatform

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 22: Installations and repos

**Files:**
- Create: `apps/server/src/platform/github/normalize/installation.ts`, `apps/server/src/platform/github/normalize/installation.test.ts`, `apps/server/src/ingest/installations.ts`, `apps/server/src/ingest/installations.db.test.ts`, `apps/server/src/http/routes/setup.ts`, `apps/server/src/http/routes/setup.db.test.ts`
- Modify: `apps/server/src/platform/github/normalize/index.ts`, `apps/server/src/http/app.ts`, `apps/server/test/app.ts`, `apps/server/src/main.ts`

**Interfaces:**
- Consumes: payload types, `AppAuth`, `currentUser`.
- Produces:
  - `normalizeInstallation`, `normalizeInstallationRepos`, `normalizeRepository` and `toRepoInfo`;
  - `syncFromEvent(ne)` for the `installation`, `installation_repos` and `repo` scopes;
  - `syncInstallationFromApi(installationId, github, appAuth)`;
  - `AppDeps` gains `appAuth: AppAuth`;
  - route `GET /github/setup` (where GitHub sends people after installing the app).

Spec §14.9: in hosted mode (`PUBLIC_REPOS_ONLY=true`), `repository.privatized` cancels that repo's jobs and purges its chats. Deleting the chats cascades to their jobs. A CLI still running one finds out when its result comes back stale; Plan 1b's hub also sends it `job.cancel`.

- [x] **Step 1: Write the failing tests**

`apps/server/src/platform/github/normalize/installation.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { installationEvent, installationReposEvent, repository, repositoryEvent } from '../../../../test/fixtures/github';
import { parseGithubWebhook } from './index';

const repo = { id: '501', fullName: 'octo/sandbox', private: false, defaultBranch: 'main' };

describe('installation events', () => {
  it('maps a new installation with its repos', async () => {
    expect(await parseGithubWebhook('installation', JSON.stringify(installationEvent('created')), async () => [])).toEqual([
      { scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo] },
    ]);
  });

  it('maps repos added to and removed from an installation', async () => {
    const other = { ...repository, id: 502, full_name: 'octo/other' };
    expect(await parseGithubWebhook('installation_repositories', JSON.stringify(installationReposEvent([other], [repository])), async () => [])).toEqual([
      { scope: 'installation_repos', installationId: '77', accountLogin: 'octo', added: [{ id: '502', fullName: 'octo/other', private: false, defaultBranch: 'main' }], removed: ['501'] },
    ]);
  });

  it.each(['privatized', 'publicized', 'deleted', 'renamed'])('maps repository.%s', async (action) => {
    expect(await parseGithubWebhook('repository', JSON.stringify(repositoryEvent(action)), async () => [])).toEqual([{ scope: 'repo', action, installationId: '77', repo }]);
  });

  it('ignores other repository actions', async () => {
    expect(await parseGithubWebhook('repository', JSON.stringify(repositoryEvent('edited')), async () => [])).toEqual([]);
  });
});
```

`apps/server/src/ingest/installations.db.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, resetDb } from '../../test/db';
import { prisma } from '../lib/prisma';
import { syncFromEvent } from './installations';

beforeEach(resetDb);
afterEach(() => vi.unstubAllEnvs());

const repo = (id: string, fullName: string, isPrivate = false) => ({ id, fullName, private: isPrivate, defaultBranch: 'main' });

describe('syncFromEvent', () => {
  it('creates an installation and its repos, then follows additions and removals', async () => {
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo('501', 'octo/a')] });
    await syncFromEvent({ scope: 'installation_repos', installationId: '77', accountLogin: 'octo', added: [repo('502', 'octo/b')], removed: ['501'] });
    expect((await prisma.repo.findMany({ orderBy: { id: 'asc' } })).map((r) => r.fullName)).toEqual(['octo/b']);
  });

  it('records suspension and lifts it', async () => {
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [] });
    await syncFromEvent({ scope: 'installation', action: 'suspend', installationId: '77', accountLogin: 'octo', repos: [] });
    expect((await prisma.installation.findUniqueOrThrow({ where: { id: '77' } })).suspendedAt).not.toBeNull();
    await syncFromEvent({ scope: 'installation', action: 'unsuspend', installationId: '77', accountLogin: 'octo', repos: [] });
    expect((await prisma.installation.findUniqueOrThrow({ where: { id: '77' } })).suspendedAt).toBeNull();
  });

  it('deletes everything when the app is uninstalled', async () => {
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo('501', 'octo/a')] });
    await makeChat('501');
    await syncFromEvent({ scope: 'installation', action: 'deleted', installationId: '77', accountLogin: 'octo', repos: [] });
    expect(await prisma.prChat.count()).toBe(0);
  });

  it('purges chats of a repo made private, in public-only mode', async () => {
    vi.stubEnv('PUBLIC_REPOS_ONLY', 'true');
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo('501', 'octo/a')] });
    await makeChat('501');
    await syncFromEvent({ scope: 'repo', action: 'privatized', installationId: '77', repo: repo('501', 'octo/a', true) });
    expect(await prisma.prChat.count()).toBe(0);
    expect((await prisma.repo.findUniqueOrThrow({ where: { id: '501' } })).private).toBe(true);
  });

  it('keeps chats of a repo made private on a self-hosted instance', async () => {
    await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [repo('501', 'octo/a')] });
    await makeChat('501');
    await syncFromEvent({ scope: 'repo', action: 'privatized', installationId: '77', repo: repo('501', 'octo/a', true) });
    expect(await prisma.prChat.count()).toBe(1);
  });
});
```
`apps/server/src/http/routes/setup.db.test.ts`:
```ts
import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { testApp } from '../../../test/app';
import { makeUser, resetDb } from '../../../test/db';
import { fakeFetch } from '../../../test/fake-fetch';
import { sessionCookieFor } from '../../../test/http';
import { prisma } from '../../lib/prisma';
import { AppAuth } from '../../platform/github/app-auth';
import { GithubClient } from '../../platform/github/client';

beforeEach(resetDb);

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

describe('GET /github/setup', () => {
  it('syncs the new installation from the API, then goes home', async () => {
    const github = new GithubClient(
      fakeFetch({
        'GET /app/installations/77': () => ({ id: 77, account: { login: 'octo' } }),
        'POST /app/installations/77/access_tokens': () => ({ token: 'ghs_x', expires_at: '2099-01-01T00:00:00Z' }),
        'GET /installation/repositories': () => ({ repositories: [{ id: 501, full_name: 'octo/sandbox', private: false, default_branch: 'main' }] }),
      }),
    );
    const user = await makeUser();
    const res = await testApp({ github, appAuth: new AppAuth(github, '12345', pem) }).request('/github/setup?installation_id=77&setup_action=install', {
      headers: { cookie: await sessionCookieFor(user.id) },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect((await prisma.repo.findUniqueOrThrow({ where: { id: '501' } })).fullName).toBe('octo/sandbox');
  });

  it('asks people who are not signed in to sign in first', async () => {
    const res = await testApp().request('/github/setup?installation_id=77');
    expect(res.headers.get('location')).toBe(`/auth/github/login?next=${encodeURIComponent('/github/setup?installation_id=77')}`);
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/server`
Expected: FAIL. The installation parse tests get `[]`, and `./installations` and `./routes/setup` don't exist yet.

- [x] **Step 3: Write the normalizers and register them**

`apps/server/src/platform/github/normalize/installation.ts`:
```ts
import type { NormalizedEvent, RepoInfo } from '../../types';
import type { GhInstallationEvent, GhInstallationReposEvent, GhRepo, GhRepositoryEvent } from '../payloads';

export function toRepoInfo(r: GhRepo): RepoInfo {
  // Installation payloads leave out default_branch. We never need it to read files:
  // GitHub's contents API reads the default branch when no ref is given.
  return { id: String(r.id), fullName: r.full_name, private: r.private, defaultBranch: r.default_branch ?? 'main' };
}

const INSTALLATION_ACTIONS = ['created', 'deleted', 'suspend', 'unsuspend'] as const;
const REPO_ACTIONS = ['privatized', 'publicized', 'deleted', 'renamed'] as const;

export function normalizeInstallation(p: GhInstallationEvent): NormalizedEvent[] {
  const action = INSTALLATION_ACTIONS.find((a) => a === p.action);
  if (!action) return [];
  return [{ scope: 'installation', action, installationId: String(p.installation.id), accountLogin: p.installation.account.login, repos: (p.repositories ?? []).map(toRepoInfo) }];
}

export function normalizeInstallationRepos(p: GhInstallationReposEvent): NormalizedEvent[] {
  return [
    {
      scope: 'installation_repos',
      installationId: String(p.installation.id),
      accountLogin: p.installation.account.login,
      added: p.repositories_added.map(toRepoInfo),
      removed: p.repositories_removed.map((r) => String(r.id)),
    },
  ];
}

export function normalizeRepository(p: GhRepositoryEvent): NormalizedEvent[] {
  const action = REPO_ACTIONS.find((a) => a === p.action);
  if (!action) return [];
  return [{ scope: 'repo', action, installationId: String(p.installation.id), repo: toRepoInfo(p.repository) }];
}
```

In `apps/server/src/platform/github/normalize/index.ts`, add the import and three cases before `default`:
```ts
import { normalizeInstallation, normalizeInstallationRepos, normalizeRepository } from './installation';
```
```ts
    case 'installation':
      return normalizeInstallation(payload);
    case 'installation_repositories':
      return normalizeInstallationRepos(payload);
    case 'repository':
      return normalizeRepository(payload);
```

- [x] **Step 4: Write the sync**

`apps/server/src/ingest/installations.ts`:
```ts
import { getEnv } from '../lib/env';
import { prisma } from '../lib/prisma';
import type { AppAuth } from '../platform/github/app-auth';
import type { GithubClient } from '../platform/github/client';
import { toRepoInfo } from '../platform/github/normalize/installation';
import type { GhRepo } from '../platform/github/payloads';
import type { NormalizedEvent, RepoInfo } from '../platform/types';

type InstallationScoped = Exclude<NormalizedEvent, { scope: 'pr' }>;

/** Keep Installation and Repo rows in step with what GitHub tells us. */
export async function syncFromEvent(ne: InstallationScoped): Promise<void> {
  switch (ne.scope) {
    case 'installation': {
      if (ne.action === 'deleted') {
        // Cascades to repos, chats, jobs, tasks.
        await prisma.installation.deleteMany({ where: { id: ne.installationId } });
        return;
      }
      const suspendedAt = ne.action === 'suspend' ? new Date() : ne.action === 'unsuspend' ? null : undefined;
      await prisma.installation.upsert({
        where: { id: ne.installationId },
        create: { id: ne.installationId, accountLogin: ne.accountLogin },
        update: { accountLogin: ne.accountLogin, suspendedAt },
      });
      await upsertRepos(ne.installationId, ne.repos);
      return;
    }
    case 'installation_repos': {
      await prisma.installation.upsert({ where: { id: ne.installationId }, create: { id: ne.installationId, accountLogin: ne.accountLogin }, update: {} });
      await upsertRepos(ne.installationId, ne.added);
      await prisma.repo.deleteMany({ where: { installationId: ne.installationId, id: { in: ne.removed } } });
      return;
    }
    case 'repo': {
      if (ne.action === 'deleted') {
        await prisma.repo.deleteMany({ where: { id: ne.repo.id } });
        return;
      }
      if (ne.action === 'privatized' && getEnv().PUBLIC_REPOS_ONLY) {
        // The hosted instance keeps no data about private repos (spec §14.9).
        await prisma.prChat.deleteMany({ where: { repoId: ne.repo.id } });
      }
      await upsertRepos(ne.installationId, [ne.repo]);
      return;
    }
  }
}

async function upsertRepos(installationId: string, repos: RepoInfo[]): Promise<void> {
  for (const r of repos) {
    await prisma.repo.upsert({
      where: { id: r.id },
      create: { id: r.id, installationId, fullName: r.fullName, private: r.private, defaultBranch: r.defaultBranch },
      update: { installationId, fullName: r.fullName, private: r.private, defaultBranch: r.defaultBranch },
    });
  }
}

/** After someone installs the app, read the installation and its repos straight from the API. */
export async function syncInstallationFromApi(installationId: string, github: GithubClient, appAuth: AppAuth): Promise<void> {
  const { data: inst } = await github.api<{ id: number; account: { login: string } }>('GET', `/app/installations/${installationId}`, { token: appAuth.jwt() });
  const token = await appAuth.installationToken(installationId);
  const { data } = await github.api<{ repositories: GhRepo[] }>('GET', '/installation/repositories?per_page=100', { token });
  await syncFromEvent({ scope: 'installation', action: 'created', installationId, accountLogin: inst.account.login, repos: data.repositories.map(toRepoInfo) });
}
```

- [x] **Step 5: Write the setup route and mount it**

`apps/server/src/http/routes/setup.ts`:
```ts
import { Hono } from 'hono';
import { currentUser } from '../../auth/session';
import { syncInstallationFromApi } from '../../ingest/installations';
import type { AppAuth } from '../../platform/github/app-auth';
import type { GithubClient } from '../../platform/github/client';
import { HttpError } from '../errors';

/** GitHub sends people here after they install or reconfigure the app (spec §10). */
export function setupRoutes(deps: { github: GithubClient; appAuth: AppAuth }): Hono {
  const app = new Hono();
  app.get('/github/setup', async (c) => {
    if (!(await currentUser(c))) {
      const here = new URL(c.req.url);
      return c.redirect(`/auth/github/login?next=${encodeURIComponent(here.pathname + here.search)}`);
    }
    const installationId = c.req.query('installation_id');
    if (!installationId || !/^\d+$/.test(installationId)) throw new HttpError('validation_error', 'missing installation_id');
    await syncInstallationFromApi(installationId, deps.github, deps.appAuth);
    return c.redirect('/');
  });
  return app;
}
```

In `apps/server/src/http/app.ts`:
- `export type AppDeps = { github: GithubClient; appAuth: AppAuth; ingest: Ingest };` with `import type { AppAuth } from '../platform/github/app-auth';`.
- `import { setupRoutes } from './routes/setup';` and `app.route('/', setupRoutes(deps));`.

In `apps/server/test/app.ts`, give `testDeps` a default `appAuth`:
```ts
import { AppAuth } from '../src/platform/github/app-auth';
```
```ts
export function testDeps(over: Partial<AppDeps> = {}): AppDeps {
  const github = over.github ?? new GithubClient(fakeFetch({}));
  return {
    github,
    appAuth: new AppAuth(github, '12345', 'tests-that-need-a-key-pass-their-own'),
    ingest: createIngest(async () => ({ status: 'ignored', note: 'test' })),
    ...over,
  };
}
```

In `apps/server/src/main.ts`, add `import { AppAuth } from './platform/github/app-auth';`, create `const appAuth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);` after `github`, and pass it: `createApp({ github, appAuth, ingest })`.

- [x] **Step 6: Run the tests to see them pass**

Run: `npm test -w apps/server && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (installation parse 7, sync 5, setup 2, plus everything earlier).

- [x] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): sync installations and repos; GitHub setup route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 23: The dispatcher and the event router

**Files:**
- Create: `apps/server/src/lib/key-lock.ts`, `apps/server/src/lib/key-lock.test.ts`, `apps/server/src/lib/markers.ts`
- Create: `apps/server/src/chats/load.ts`, `apps/server/src/chats/save.ts`, `apps/server/src/chats/apply-commands.ts`, `apps/server/src/chats/dispatch.ts`, `apps/server/src/chats/dispatch.db.test.ts`
- Create: `apps/server/src/chats/rules.ts`, `apps/server/src/chats/people.ts`, `apps/server/src/chats/refs.ts`, `apps/server/src/chats/route-event.ts`, `apps/server/src/ingest/handle.ts`, `apps/server/src/chats/route-event.db.test.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Consumes: `decide`, `parseTeamRules`, `PlatformReads`, `prisma`, `Tx`, `isTrustedAssociation`, `syncFromEvent`.
- Produces:
  - `KeyedLock.run(key, work)`;
  - `markers.ts`: `summaryMarker(chatId)`, `writeMarker(chatId, taskId, pointNumber?)`, `containsMarker(body)`;
  - `loadChat(chatId) → { state, rules }`, `saveChatState(tx, chatId, before, after, now)` and `appendTimeline(tx, chatId, items)`;
  - `applyCommands(tx, chatId, commands, now) → DispatchEffects`;
  - `Dispatcher` (`dispatch(chatId, event)`, `onCommit(listener)`), `type Dispatch` and `DispatchEffects` (`{ jobsChanged, tasksCreated, cancelledJobs: { id, attempt, cliTokenId, reason }[] }`); Plan 1b's hub uses `cancelledJobs`;
  - `rulesFromJson`, `ensureFreshRules(repo, platform)`, `repoRef(repo)` and `prRefOf(chat & { repo })`;
  - `withPeople(event, rules)`;
  - `routePrEvent(ne, deps) → string | null` (null = dispatched, else the reason it was ignored);
  - `createDeliveryHandler({ platform, dispatch }) → DeliveryHandler`.

The dispatcher implements spec §9's steps:
1. Take the chat's in-memory lock.
2. Load the chat's state.
3. Call `decide`.
4. In one transaction, write the new state, the timeline items (`seq = ++lastSeq`), the jobs and the tasks.
5. After the commit, notify listeners (wake the task runner; in Plan 1b, the CLI hub).

The router runs **before** the lock. It is the only place that calls GitHub (to read `.nitpilot.yml` and missing PRs) on the way in.

- [x] **Step 1: Write the small helpers**

`apps/server/src/lib/key-lock.ts`:
```ts
/** Runs async work one at a time per key, so two events for the same chat never interleave. */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // Wait for the previous holder whether it succeeded or failed, then run.
    const current = previous.catch(() => undefined).then(work);
    this.tails.set(key, current);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}
```

`apps/server/src/lib/key-lock.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { KeyedLock } from './key-lock';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('KeyedLock', () => {
  it('runs work for the same key one at a time, and different keys in parallel', async () => {
    const lock = new KeyedLock();
    const log: string[] = [];
    const job = (key: string, name: string) => lock.run(key, async () => { log.push(`start ${name}`); await tick(); log.push(`end ${name}`); });
    await Promise.all([job('chat-1', 'a'), job('chat-1', 'b'), job('chat-2', 'c')]);
    expect(log.indexOf('end a')).toBeLessThan(log.indexOf('start b'));
    expect(log.indexOf('start c')).toBeLessThan(log.indexOf('end a'));
  });

  it('keeps going after a failure', async () => {
    const lock = new KeyedLock();
    await expect(lock.run('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(lock.run('k', async () => 'ok')).resolves.toBe('ok');
  });
});
```

`apps/server/src/lib/markers.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';

// Every body Nitpilot writes to GitHub carries a hidden HTML comment, so we can recognize our
// own writes when their webhooks come back (spec §15) and find them again after a crash.

const PREFIX = `<!-- ${BRAND.commentMarker}`;

export function summaryMarker(chatId: string): string {
  return `${PREFIX} chat=${chatId} -->`;
}

export function writeMarker(chatId: string, taskId: string, pointNumber?: number): string {
  return `${PREFIX} chat=${chatId} task=${taskId}${pointNumber ? ` point=${pointNumber}` : ''} -->`;
}

export function containsMarker(body: string | null | undefined): boolean {
  return !!body && body.includes(PREFIX);
}
```

- [x] **Step 2: Write the failing dispatcher test**

`apps/server/src/chats/dispatch.db.test.ts`:
```ts
import { samples } from '@nitpilot/protocol';
import { describe, expect, it } from 'vitest';
import { ghId, makeChat, makeRepo, makeUser } from '../../test/db';
import type { Person } from '../engine/types';
import { prisma } from '../lib/prisma';
import { Dispatcher, type DispatchEffects } from './dispatch';

async function scene() {
  const maya = await makeUser({ login: 'maya' });
  const leo = await makeUser({ login: 'leo' });
  const chat = await makeChat((await makeRepo()).id, { authorGithubId: maya.githubId });
  const person = (u: { id: string; githubId: string; login: string }): Person => ({ githubId: u.githubId, login: u.login, isBot: false, userId: u.id });
  const dispatcher = new Dispatcher();
  const effects: DispatchEffects[] = [];
  dispatcher.onCommit((_chatId, e) => effects.push(e));
  await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: person(maya), reviewers: [person(leo)] });
  return { maya, leo, chat, person, dispatcher, effects };
}

describe('Dispatcher', () => {
  it('saves participants, the review job and the timeline in one go', async () => {
    const { chat, leo, effects } = await scene();
    const saved = await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id }, include: { participants: true, jobs: true, messages: { orderBy: { seq: 'asc' } } } });
    expect(saved.phase).toBe('reviewing');
    expect(saved.participants.map((p) => [p.login, p.role, p.requested])).toEqual(expect.arrayContaining([['maya', 'author', false], ['leo', 'reviewer', true]]));
    expect(saved.jobs).toEqual([expect.objectContaining({ type: 'review', status: 'queued', userId: leo.id, headSha: chat.headSha })]);
    expect(saved.jobs[0]!.activeFor).toBe(saved.jobs[0]!.participantId);
    expect(saved.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(saved.lastSeq).toBe(2);
    expect(effects[0]).toMatchObject({ jobsChanged: true });
  });

  it('serializes events for one chat so timeline numbers never collide', async () => {
    const { chat, maya, person, dispatcher } = await scene();
    await Promise.all(Array.from({ length: 5 }, (_, i) => dispatcher.dispatch(chat.id, { type: 'human_note', author: person(maya), body: `note ${i}` })));
    const seqs = (await prisma.message.findMany({ where: { chatId: chat.id }, orderBy: { seq: 'asc' } })).map((m) => m.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('applies a review result: points, a finished job and the next job', async () => {
    const { chat, maya, dispatcher } = await scene();
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });

    await dispatcher.dispatch(chat.id, { type: 'job_completed', jobId: job.id, result: samples.jobResult() });

    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'done', activeFor: null, applyState: 'applied' });
    expect(await prisma.point.findMany({ where: { chatId: chat.id } })).toEqual([expect.objectContaining({ number: 1, status: 'open', origin: 'agent', severity: 'major' })]);
    expect(await prisma.job.findFirst({ where: { chatId: chat.id, status: 'queued' } })).toMatchObject({ type: 'address', userId: maya.id });
    expect(await prisma.task.findUnique({ where: { dedupeKey: `summary:${chat.id}` } })).toMatchObject({ kind: 'summary', status: 'pending' });
  });

  it('reports cancelled running jobs to listeners, for the CLI hub', async () => {
    const { chat, dispatcher, effects } = await scene();
    const job = await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } });
    await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1 } });
    await dispatcher.dispatch(chat.id, { type: 'pr_closed', merged: false });
    expect(effects.at(-1)!.cancelledJobs).toEqual([{ id: job.id, attempt: 1, cliTokenId: null, reason: 'pr_closed' }]);
    expect((await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id } })).closedAt).not.toBeNull();
  });

  it('debounces timers: scheduling the same key twice keeps one task at the later time', async () => {
    const repo = await makeRepo();
    const author = await makeUser();
    const chat = await makeChat(repo.id, { authorGithubId: author.githubId });
    const dispatcher = new Dispatcher();
    const sam: Person = { githubId: ghId(), login: 'sam', isBot: false, userId: null };
    const comment = (id: string) => ({ id, threadRootId: null, author: sam, trusted: true, body: 'x', path: null, line: null, side: null, commitSha: null });
    await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: { githubId: author.githubId, login: author.login, isBot: false, userId: author.id }, reviewers: [] });
    await dispatcher.dispatch(chat.id, { type: 'external_comment', comment: comment(ghId()) });
    const first = await prisma.task.findUniqueOrThrow({ where: { dedupeKey: `timer:${chat.id}:comments` } });
    await dispatcher.dispatch(chat.id, { type: 'external_comment', comment: comment(ghId()) });
    const second = await prisma.task.findUniqueOrThrow({ where: { dedupeKey: `timer:${chat.id}:comments` } });
    expect(second.id).toBe(first.id);
    expect(second.runAt.getTime()).toBeGreaterThanOrEqual(first.runAt.getTime());
  });

  it('queues a job for someone who joined Nitpilot after the chat started', async () => {
    const repo = await makeRepo();
    const author = await makeUser();
    const chat = await makeChat(repo.id, { authorGithubId: author.githubId });
    const latecomerGithubId = ghId();
    const dispatcher = new Dispatcher();
    const authorP: Person = { githubId: author.githubId, login: author.login, isBot: false, userId: author.id };
    await dispatcher.dispatch(chat.id, { type: 'pr_opened', author: authorP, reviewers: [{ githubId: latecomerGithubId, login: 'kim', isBot: false, userId: null }] });
    expect(await prisma.job.count({ where: { chatId: chat.id } })).toBe(0);

    const kim = await makeUser({ githubId: latecomerGithubId, login: 'kim' });
    await dispatcher.dispatch(chat.id, { type: 'review_requested', reviewer: { githubId: latecomerGithubId, login: 'kim', isBot: false, userId: kim.id } });
    expect(await prisma.job.findFirstOrThrow({ where: { chatId: chat.id } })).toMatchObject({ userId: kim.id, type: 'review' });
  });
});
```

- [x] **Step 3: Run the tests to see them fail**

Run: `npm test -w apps/server`
Expected: FAIL, `Failed to resolve import "./dispatch"`. The key-lock test fails the same way until Step 1's file is saved, then passes.

- [x] **Step 4: Write load, save and apply-commands**

`apps/server/src/chats/rules.ts`:
```ts
import { BRAND, DEFAULT_RULES, TeamRulesSchema, type TeamRules } from '@nitpilot/protocol';
import { parseTeamRules } from '../engine/rules';
import { Prisma, type Repo } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import type { PlatformReads, RepoRef } from '../platform/types';

export function repoRef(repo: Pick<Repo, 'id' | 'installationId' | 'fullName'>): RepoRef {
  return { installationId: repo.installationId, repoId: repo.id, repoFullName: repo.fullName };
}

/** The rules stored on a repo; anything missing or broken means the defaults. */
export function rulesFromJson(json: unknown): TeamRules {
  const parsed = TeamRulesSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : DEFAULT_RULES;
}

/**
 * Re-read `.nitpilot.yml` from the default branch when a round may start (spec §13). The ETag
 * makes an unchanged file cost nothing. GitHub trouble keeps the rules we already have.
 */
export async function ensureFreshRules(repo: Repo, platform: PlatformReads): Promise<Repo> {
  let file: Awaited<ReturnType<PlatformReads['readDefaultBranchFile']>>;
  try {
    file = await platform.readDefaultBranchFile(repoRef(repo), BRAND.teamConfigFile, repo.rulesEtag ?? undefined);
  } catch (err) {
    console.warn(`[rules] could not read ${BRAND.teamConfigFile} for ${repo.fullName}; keeping the cached rules`, err);
    return repo;
  }
  if (file === 'not_modified') return repo;
  if (file === null) {
    return prisma.repo.update({ where: { id: repo.id }, data: { rulesJson: Prisma.DbNull, rulesEtag: null, rulesError: null } });
  }
  const { rules, error } = parseTeamRules(file.text);
  return prisma.repo.update({
    where: { id: repo.id },
    data: { rulesJson: error ? Prisma.DbNull : rules, rulesEtag: file.etag, rulesError: error },
  });
}
```

`apps/server/src/chats/refs.ts`:
```ts
import type { PrChat, Repo } from '../generated/prisma/client';
import type { PrRef } from '../platform/types';

export function prRefOf(chat: PrChat & { repo: Repo }): PrRef {
  return { installationId: chat.repo.installationId, repoId: chat.repoId, repoFullName: chat.repo.fullName, number: chat.number };
}
```

`apps/server/src/chats/load.ts`:
```ts
import type { ApplyState, Attention, Category, EscalationReason, JobStatus, JobType, Phase, PointOrigin, PointStatus, Resolution, Role, Severity, Side, Snippet, TeamRules } from '@nitpilot/protocol';
import type { ChatState, PointState } from '../engine/types';
import type { Point } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { rulesFromJson } from './rules';

export type LoadedChat = { state: ChatState; rules: TeamRules };

/** Read one chat into the shape the engine works on. Status columns are strings in the DB; here they get their types back. */
export async function loadChat(chatId: string): Promise<LoadedChat> {
  const row = await prisma.prChat.findUniqueOrThrow({
    where: { id: chatId },
    include: {
      repo: true,
      participants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      points: { orderBy: { number: 'asc' } },
      jobs: { where: { status: { in: ['queued', 'running'] } }, include: { participant: true } },
    },
  });

  // Who uses Nitpilot can change after the chat started, so look it up fresh every time.
  const users = await prisma.user.findMany({ where: { githubId: { in: row.participants.map((p) => p.githubId) } }, select: { id: true, githubId: true } });
  const userIdOf = new Map(users.map((u) => [u.githubId, u.id]));

  const state: ChatState = {
    phase: row.phase as Phase,
    round: row.round,
    addressPasses: row.addressPasses,
    headSha: row.headSha,
    isDraft: row.isDraft,
    trusted: row.trusted,
    merged: row.merged,
    closed: row.closedAt !== null,
    authorGithubId: row.authorGithubId,
    participants: row.participants.map((p) => ({
      githubId: p.githubId,
      login: p.login,
      role: p.role as Role,
      userId: p.isBot ? null : (userIdOf.get(p.githubId) ?? null),
      isBot: p.isBot,
      auto: p.auto,
      requested: p.requested,
      lastReviewedSha: p.lastReviewedSha,
      attention: p.attention as Attention,
    })),
    points: row.points.map(toPointState),
    jobs: row.jobs.map((j) => ({
      id: j.id,
      participantGithubId: j.participant.githubId,
      role: j.participant.role as Role,
      jobType: j.type as JobType,
      status: j.status as JobStatus,
      round: j.round,
      attempt: j.attempt,
      headSha: j.headSha,
      applyState: j.applyState as ApplyState,
    })),
  };
  return { state, rules: rulesFromJson(row.repo.rulesJson) };
}

function toPointState(p: Point): PointState {
  return {
    number: p.number,
    raisedBy: p.raisedByGithubId,
    origin: p.origin as PointOrigin,
    jobId: p.jobId,
    githubCommentId: p.githubCommentId,
    githubThreadRootId: p.githubThreadRootId,
    path: p.path,
    line: p.line,
    side: p.side as Side | null,
    commitSha: p.commitSha,
    severity: p.severity as Severity,
    category: p.category as Category,
    title: p.title,
    body: p.body,
    snippet: p.snippet as Snippet | null,
    status: p.status as PointStatus,
    authorResolution: p.authorResolution as Resolution | null,
    escalationReason: p.escalationReason as EscalationReason | null,
    trusted: p.trusted,
    round: p.round,
  };
}
```

`apps/server/src/chats/save.ts`:
```ts
import type { ChatState, NewItem, ParticipantState, PointState } from '../engine/types';
import type { Prisma } from '../generated/prisma/client';
import type { Tx } from '../lib/prisma';

// The engine returns a whole new ChatState; here we write only what changed.
// Participants are matched by (githubId, role) and points by number: the engine's natural keys.

const PARTICIPANT_FIELDS = ['login', 'userId', 'isBot', 'auto', 'requested', 'lastReviewedSha', 'attention'] as const;
const POINT_FIELDS = ['status', 'authorResolution', 'escalationReason', 'trusted', 'githubCommentId', 'githubThreadRootId'] as const;

function pick<T, K extends keyof T>(obj: T, fields: readonly K[]): Pick<T, K> {
  return Object.fromEntries(fields.map((f) => [f, obj[f]])) as Pick<T, K>;
}

function changed<T>(a: T, b: T, fields: readonly (keyof T)[]): boolean {
  return fields.some((f) => a[f] !== b[f]);
}

export async function saveChatState(tx: Tx, chatId: string, before: ChatState, after: ChatState, now: Date): Promise<void> {
  await tx.prChat.update({
    where: { id: chatId },
    data: {
      phase: after.phase,
      round: after.round,
      addressPasses: after.addressPasses,
      headSha: after.headSha,
      isDraft: after.isDraft,
      trusted: after.trusted,
      merged: after.merged,
      // Keep the original close time; clear it on reopen.
      closedAt: after.closed ? (before.closed ? undefined : now) : null,
      pointCount: after.points.length,
    },
  });

  for (const p of after.participants) {
    const old = before.participants.find((b) => b.githubId === p.githubId && b.role === p.role);
    if (!old) {
      await tx.participant.create({ data: { chatId, githubId: p.githubId, role: p.role, ...pick(p, PARTICIPANT_FIELDS) } });
    } else if (changed<ParticipantState>(old, p, PARTICIPANT_FIELDS)) {
      await tx.participant.update({ where: { chatId_githubId_role: { chatId, githubId: p.githubId, role: p.role } }, data: pick(p, PARTICIPANT_FIELDS) });
    }
  }

  for (const pt of after.points) {
    const old = before.points.find((b) => b.number === pt.number);
    if (!old) {
      await tx.point.create({
        data: {
          chatId,
          number: pt.number,
          raisedByGithubId: pt.raisedBy,
          origin: pt.origin,
          jobId: pt.jobId,
          githubCommentId: pt.githubCommentId,
          githubThreadRootId: pt.githubThreadRootId,
          path: pt.path,
          line: pt.line,
          side: pt.side,
          commitSha: pt.commitSha,
          severity: pt.severity,
          category: pt.category,
          title: pt.title,
          body: pt.body,
          snippet: (pt.snippet ?? undefined) as Prisma.InputJsonValue | undefined,
          status: pt.status,
          authorResolution: pt.authorResolution,
          escalationReason: pt.escalationReason,
          trusted: pt.trusted,
          round: pt.round,
        },
      });
    } else if (changed<PointState>(old, pt, POINT_FIELDS)) {
      await tx.point.update({ where: { chatId_number: { chatId, number: pt.number } }, data: pick(pt, POINT_FIELDS) });
    }
  }
}

/** Append timeline items with the next sequence numbers (the chat's resume cursor). */
export async function appendTimeline(tx: Tx, chatId: string, items: NewItem[]): Promise<void> {
  if (items.length === 0) return;
  const { lastSeq } = await tx.prChat.update({ where: { id: chatId }, data: { lastSeq: { increment: items.length } }, select: { lastSeq: true } });
  const first = lastSeq - items.length + 1;
  await tx.message.createMany({
    data: items.map((item, i) => ({
      chatId,
      seq: first + i,
      kind: item.kind,
      authorGithubId: item.author?.githubId ?? null,
      authorLogin: item.author?.login ?? null,
      pointNumber: item.pointNumber,
      jobId: item.jobId,
      body: item.body,
      data: (item.data ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
}
```

`apps/server/src/chats/apply-commands.ts`:
```ts
import type { Command } from '../engine/types';
import type { Prisma } from '../generated/prisma/client';
import type { Tx } from '../lib/prisma';

/** Summary edits wait for 5 quiet seconds, so a burst of changes makes one GitHub request (spec §15). */
export const SUMMARY_DEBOUNCE_MS = 5_000;

export type DispatchEffects = {
  jobsChanged: boolean;
  tasksCreated: boolean;
  /** Jobs that were running on a CLI when cancelled; Plan 1b's hub sends them job.cancel. */
  cancelledJobs: { id: string; attempt: number; cliTokenId: string | null; reason: string }[];
};

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Turn the engine's commands into Job and Task rows, inside the dispatcher's transaction. */
export async function applyCommands(tx: Tx, chatId: string, commands: Command[], now: Date): Promise<DispatchEffects> {
  const effects: DispatchEffects = { jobsChanged: false, tasksCreated: false, cancelledJobs: [] };

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'enqueue_job': {
        const p = await tx.participant.findUniqueOrThrow({ where: { chatId_githubId_role: { chatId, githubId: cmd.participant.githubId, role: cmd.participant.role } } });
        // Look the account up fresh: the participant row may predate them joining Nitpilot.
        const user = await tx.user.findUnique({ where: { githubId: p.githubId } });
        if (!user) throw new Error(`cannot queue a job for ${p.login}: not on Nitpilot`);
        if (p.userId !== user.id) await tx.participant.update({ where: { id: p.id }, data: { userId: user.id } });
        const chat = await tx.prChat.findUniqueOrThrow({ where: { id: chatId }, select: { headSha: true } });
        await tx.job.create({
          data: { chatId, participantId: p.id, activeFor: p.id, userId: user.id, type: cmd.jobType, round: cmd.round, headSha: chat.headSha, sinceSha: cmd.sinceSha, applyState: cmd.applyState, runAfter: now },
        });
        effects.jobsChanged = true;
        break;
      }
      case 'cancel_jobs': {
        const jobs = await tx.job.findMany({ where: { id: { in: cmd.jobIds }, status: { in: ['queued', 'running'] } } });
        await tx.job.updateMany({ where: { id: { in: jobs.map((j) => j.id) } }, data: { status: 'cancelled', cancelReason: cmd.reason, activeFor: null, leaseExpiresAt: null } });
        for (const j of jobs) if (j.status === 'running') effects.cancelledJobs.push({ id: j.id, attempt: j.attempt, cliTokenId: j.cliTokenId, reason: cmd.reason });
        effects.jobsChanged = true;
        break;
      }
      case 'complete_job':
        await tx.job.update({ where: { id: cmd.jobId }, data: { status: 'done', activeFor: null, leaseExpiresAt: null, result: json(cmd.result), applyState: cmd.applyState } });
        effects.jobsChanged = true;
        break;
      case 'retry_job':
        await tx.job.update({
          where: { id: cmd.jobId },
          data: { status: 'queued', runAfter: cmd.runAfter, cliTokenId: null, leaseExpiresAt: null, ...(cmd.refundAttempt ? { attempt: { decrement: 1 } } : {}) },
        });
        effects.jobsChanged = true;
        break;
      case 'fail_job':
        await tx.job.update({ where: { id: cmd.jobId }, data: { status: 'failed', failure: cmd.reason, activeFor: null, leaseExpiresAt: null } });
        effects.jobsChanged = true;
        break;
      case 'schedule':
        await upsertTask(tx, `timer:${chatId}:${cmd.key}`, { kind: 'timer', chatId, payload: json({ key: cmd.key }), runAt: cmd.at });
        effects.tasksCreated = true;
        break;
      case 'unschedule':
        await tx.task.deleteMany({ where: { dedupeKey: `timer:${chatId}:${cmd.key}`, status: 'pending' } });
        break;
      case 'upsert_summary':
        await upsertTask(tx, `summary:${chatId}`, { kind: 'summary', chatId, payload: json({}), runAt: new Date(now.getTime() + SUMMARY_DEBOUNCE_MS) });
        effects.tasksCreated = true;
        break;
      case 'post_review':
        await tx.task.create({ data: { kind: 'post_review', chatId, runAt: now, payload: json({ reviewerGithubId: cmd.reviewerGithubId, pointNumbers: cmd.pointNumbers }) } });
        effects.tasksCreated = true;
        break;
      case 'post_thread_replies':
        await tx.task.create({ data: { kind: 'thread_replies', chatId, runAt: now, payload: json({ asGithubId: cmd.asGithubId, replies: cmd.replies }) } });
        effects.tasksCreated = true;
        break;
      case 'notify':
        await tx.task.create({ data: { kind: 'notify', chatId, runAt: now, payload: json({ userIds: cmd.userIds, kind: cmd.kind, pointNumbers: cmd.pointNumbers }) } });
        effects.tasksCreated = true;
        break;
      default: {
        const unhandled: never = cmd;
        throw new Error(`Unhandled command: ${JSON.stringify(unhandled)}`);
      }
    }
  }
  return effects;
}

/** A debounce: one row per key; scheduling again moves it and makes it pending again. */
async function upsertTask(tx: Tx, dedupeKey: string, task: { kind: string; chatId: string; payload: Prisma.InputJsonValue; runAt: Date }): Promise<void> {
  await tx.task.upsert({
    where: { dedupeKey },
    create: { ...task, dedupeKey },
    update: { payload: task.payload, runAt: task.runAt, status: 'pending', attempts: 0, lastError: null },
  });
}
```

`apps/server/src/chats/dispatch.ts`:
```ts
import { decide } from '../engine/decide';
import type { DecideOutput, DomainEvent } from '../engine/types';
import { KeyedLock } from '../lib/key-lock';
import { prisma } from '../lib/prisma';
import { applyCommands, type DispatchEffects } from './apply-commands';
import { loadChat } from './load';
import { appendTimeline, saveChatState } from './save';

export type { DispatchEffects };
export type Dispatch = (chatId: string, event: DomainEvent) => Promise<DecideOutput>;
type Listener = (chatId: string, effects: DispatchEffects) => void;

/**
 * Runs one event through the engine and saves the result (spec §9 "The dispatcher").
 * Events for the same chat run one at a time; GitHub is never called while the lock is held.
 */
export class Dispatcher {
  private readonly locks = new KeyedLock();
  private readonly listeners: Listener[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Called after each commit, e.g. to wake the task runner. */
  onCommit(listener: Listener): void {
    this.listeners.push(listener);
  }

  dispatch: Dispatch = (chatId, event) =>
    this.locks.run(chatId, async () => {
      const loaded = await loadChat(chatId);
      const now = this.now();
      const out = decide({ chat: loaded.state, rules: loaded.rules, event, now });
      const effects = await prisma.$transaction(async (tx) => {
        await saveChatState(tx, chatId, loaded.state, out.chat, now);
        await appendTimeline(tx, chatId, out.timeline);
        return applyCommands(tx, chatId, out.commands, now);
      });
      for (const listener of this.listeners) {
        try {
          listener(chatId, effects);
        } catch (err) {
          console.error('[dispatch] listener failed:', err);
        }
      }
      return out;
    });
}
```

- [x] **Step 5: Run the dispatcher tests to see them pass**

Run: `npm run test:db -w apps/server -- src/chats/dispatch && npm run test:unit -w apps/server -- src/lib/key-lock`
Expected: PASS (dispatcher 6, key lock 2).

- [x] **Step 6: Write the failing router tests**

`apps/server/src/chats/route-event.db.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../../test/db';
import { issueCommentEvent, people, prEvent, pull, reviewComment, reviewCommentEvent, reviewEvent } from '../../test/fixtures/github';
import { createDeliveryHandler } from '../ingest/handle';
import { syncFromEvent } from '../ingest/installations';
import { summaryMarker } from '../lib/markers';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';
import { snapshotFromPull } from '../platform/github/mapping';
import { Dispatcher } from './dispatch';

beforeEach(resetDb);

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };

async function setup() {
  await syncFromEvent({ scope: 'installation', action: 'created', installationId: '77', accountLogin: 'octo', repos: [{ id: '501', fullName: 'octo/sandbox', private: false, defaultBranch: 'main' }] });
  const maya = await prisma.user.create({ data: { githubId: String(people.maya.id), login: 'maya' } });
  const leo = await prisma.user.create({ data: { githubId: String(people.leo.id), login: 'leo' } });
  const platform = new FakePlatform();
  platform.addPr(snapshotFromPull(ref, pull()));
  const dispatcher = new Dispatcher();
  const handle = createDeliveryHandler({ platform, dispatch: dispatcher.dispatch });
  let n = 0;
  const deliver = (event: string, payload: unknown) => handle({ deliveryId: `d-${++n}`, event, body: JSON.stringify(payload) });
  return { maya, leo, platform, deliver };
}

const chat = () => prisma.prChat.findUniqueOrThrow({ where: { repoId_number: { repoId: '501', number: 42 } }, include: { points: true, jobs: true, participants: true } });

afterEach(() => vi.unstubAllEnvs());

describe('routing PR events', () => {
  it('creates the chat and queues a review for a reviewer on Nitpilot', async () => {
    const { leo, deliver } = await setup();
    expect(await deliver('pull_request', prEvent('opened'))).toEqual({ status: 'processed' });
    const c = await chat();
    expect(c).toMatchObject({ phase: 'reviewing', trusted: true, title: 'Cursor pagination for orders' });
    expect(c.jobs).toEqual([expect.objectContaining({ type: 'review', userId: leo.id })]);
  });

  it('builds a chat it has never seen from the API, starting with pr_opened', async () => {
    const { deliver } = await setup();
    await deliver('pull_request_review_comment', reviewCommentEvent('created'));
    const c = await chat();
    expect(c.participants.map((p) => p.login)).toEqual(expect.arrayContaining(['maya', 'leo', 'sam']));
    expect(c.points).toEqual([expect.objectContaining({ githubCommentId: '9001', origin: 'github' })]);
  });

  it('reads .nitpilot.yml when a round may start, and remembers a broken one', async () => {
    const { platform, deliver } = await setup();
    platform.files.set('octo/sandbox:.nitpilot.yml', 'max_rounds: 99\n');
    await deliver('pull_request', prEvent('opened'));
    const repo = await prisma.repo.findUniqueOrThrow({ where: { id: '501' } });
    expect(repo.rulesJson).toBeNull();
    expect(repo.rulesError).toMatch(/max_rounds/);
  });

  it('trusts the bots listed in trusted_bots', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    await deliver('pull_request_review_comment', reviewCommentEvent('created', reviewComment({ id: 9300, user: people.rabbit, author_association: 'NONE' })));
    expect((await chat()).points.find((p) => p.githubCommentId === '9300')!.trusted).toBe(true);
  });

  it('ignores events for repos it does not know, and private repos in public-only mode', async () => {
    const { deliver } = await setup();
    const other = { ...prEvent('opened'), repository: { id: 999, full_name: 'x/y', private: false } };
    expect(await deliver('pull_request', other)).toMatchObject({ status: 'ignored', note: expect.stringMatching(/unknown repo/) });

    vi.stubEnv('PUBLIC_REPOS_ONLY', 'true');
    const secret = { ...prEvent('opened'), repository: { id: 501, full_name: 'octo/sandbox', private: true } };
    expect(await deliver('pull_request', secret)).toMatchObject({ status: 'ignored', note: expect.stringMatching(/private/) });
  });
});

describe('our own writes coming back (Review Focus #1)', () => {
  it('ignores a comment carrying our marker', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    const c = await chat();
    const res = await deliver('issue_comment', issueCommentEvent('created', { id: 8100, user: people.bot, body: `${summaryMarker(c.id)}\n🤖 Nitpilot …` }));
    expect(res).toMatchObject({ status: 'ignored', note: expect.stringMatching(/our own/) });
    expect((await chat()).points).toEqual([]);
  });

  it('ignores a comment or review whose id we recorded as ours', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    const c = await chat();
    await prisma.githubWrite.createMany({ data: [{ chatId: c.id, kind: 'reply', githubId: '9400' }, { chatId: c.id, kind: 'review', githubId: '7400' }] });
    expect(await deliver('pull_request_review_comment', reviewCommentEvent('created', reviewComment({ id: 9400 })))).toMatchObject({ status: 'ignored' });
    expect(await deliver('pull_request_review', reviewEvent('COMMENTED', { id: 7400, body: 'from our agent' }))).toMatchObject({ status: 'ignored' });
  });

  it('marks a push we announced as ours', async () => {
    const { deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    const c = await chat();
    await prisma.job.updateMany({ where: { chatId: c.id }, data: { expectedPushSha: 'c'.repeat(40) } });
    await deliver('pull_request', prEvent('synchronize', { before: 'a'.repeat(40), after: 'c'.repeat(40) }));
    const after = await chat();
    expect(after.headSha).toBe('c'.repeat(40));
    expect(await prisma.message.count({ where: { chatId: c.id, body: { startsWith: 'New commits pushed' } } })).toBe(0);
  });
});

describe('a comment that arrives twice (Review Focus #3)', () => {
  it('becomes one point whether it comes alone or inside a review', async () => {
    const { platform, deliver } = await setup();
    await deliver('pull_request', prEvent('opened'));
    await deliver('pull_request_review_comment', reviewCommentEvent('created', reviewComment({ id: 9500 })));
    platform.reviewComments.set('7500', [reviewComment({ id: 9500 })]);
    await deliver('pull_request_review', reviewEvent('CHANGES_REQUESTED', { id: 7500 }));
    expect((await chat()).points.filter((p) => p.githubCommentId === '9500')).toHaveLength(1);
  });
});
```
- [x] **Step 7: Run the router tests to see them fail**

Run: `npm run test:db -w apps/server -- src/chats/route-event`
Expected: FAIL, `Failed to resolve import "../ingest/handle"`.

- [x] **Step 8: Write people, the router and the delivery handler**

`apps/server/src/chats/people.ts`:
```ts
import type { TeamRules } from '@nitpilot/protocol';
import type { DomainEvent, ExternalComment, Person } from '../engine/types';
import { prisma } from '../lib/prisma';

function peopleIn(event: DomainEvent): Person[] {
  switch (event.type) {
    case 'pr_opened':
      return [event.author, ...event.reviewers];
    case 'review_requested':
    case 'review_request_removed':
    case 'manual_review':
      return [event.reviewer];
    case 'human_note':
      return [event.author];
    case 'external_comment':
      return [event.comment.author];
    case 'external_review_submitted':
      return [event.review.author, ...event.review.comments.map((c) => c.author)];
    default:
      return [];
  }
}

/**
 * Fill in who uses Nitpilot (`userId`), and trust the bots the team listed in `trusted_bots`.
 * Platform adapters don't know about Nitpilot accounts; this is where they're added.
 */
export async function withPeople(event: DomainEvent, rules: TeamRules): Promise<DomainEvent> {
  const githubIds = peopleIn(event).map((p) => p.githubId);
  const users = githubIds.length ? await prisma.user.findMany({ where: { githubId: { in: githubIds } }, select: { id: true, githubId: true } }) : [];
  const userIdOf = new Map(users.map((u) => [u.githubId, u.id]));
  const fill = (p: Person): Person => ({ ...p, userId: p.isBot ? null : (userIdOf.get(p.githubId) ?? null) });
  const trusted = (p: Person, already: boolean) => already || (p.isBot && rules.trusted_bots.includes(p.login));
  const comment = (c: ExternalComment): ExternalComment => ({ ...c, author: fill(c.author), trusted: trusted(c.author, c.trusted) });

  switch (event.type) {
    case 'pr_opened':
      return { ...event, author: fill(event.author), reviewers: event.reviewers.map(fill) };
    case 'review_requested':
    case 'review_request_removed':
    case 'manual_review':
      return { ...event, reviewer: fill(event.reviewer) };
    case 'human_note':
      return { ...event, author: fill(event.author) };
    case 'external_comment':
      return { ...event, comment: comment(event.comment) };
    case 'external_review_submitted': {
      const r = event.review;
      return { ...event, review: { ...r, author: fill(r.author), trusted: trusted(r.author, r.trusted), comments: r.comments.map(comment) } };
    }
    default:
      return event;
  }
}
```

`apps/server/src/chats/route-event.ts`:
```ts
import type { TeamRules } from '@nitpilot/protocol';
import type { DomainEvent } from '../engine/types';
import type { PrChat } from '../generated/prisma/client';
import { getEnv } from '../lib/env';
import { containsMarker } from '../lib/markers';
import { prisma } from '../lib/prisma';
import { isTrustedAssociation } from '../platform/github/mapping';
import type { PlatformReads, PrNormalizedEvent, PrSnapshot } from '../platform/types';
import type { Dispatch } from './dispatch';
import { withPeople } from './people';
import { ensureFreshRules, rulesFromJson } from './rules';

export type RouterDeps = { platform: PlatformReads; dispatch: Dispatch };

/** Events after which a round may start, so the team rules should be current (spec §13). */
const ROUND_STARTERS: ReadonlySet<DomainEvent['type']> = new Set<DomainEvent['type']>(['pr_opened', 'pr_ready', 'pr_reopened', 'review_requested', 'head_updated', 'external_review_submitted', 'manual_review']);

/**
 * Get one PR event ready and hand it to the dispatcher. Returns null when it was dispatched,
 * or the reason it was ignored. Runs outside the chat lock, so it may call the platform.
 */
export async function routePrEvent(ne: PrNormalizedEvent, deps: RouterDeps): Promise<string | null> {
  let repo = await prisma.repo.findUnique({ where: { id: ne.pr.repoId } });
  if (!repo) return 'unknown repo (installation not synced)';
  if (getEnv().PUBLIC_REPOS_ONLY && repo.private) return 'private repo (public-only mode)';

  if (await isOwnWrite(ne.event)) return 'our own write';
  const fresh = await keepUnseenComments(ne.event);
  if (!fresh) return 'comment already handled';

  let chat = await prisma.prChat.findUnique({ where: { repoId_number: { repoId: repo.id, number: ne.pr.number } } });
  if (!chat || ROUND_STARTERS.has(fresh.type)) repo = await ensureFreshRules(repo, deps.platform);
  const rules = rulesFromJson(repo.rulesJson);
  let event = await withPeople(fresh, rules);

  if (!chat) {
    if (event.type === 'pr_closed') return 'closed PR that was never tracked';
    const snapshot = ne.snapshot ?? (await deps.platform.getPr(ne.pr));
    chat = await createChat(repo.id, snapshot, rules);
    // A PR we first meet through a comment or review still starts with "opened".
    if (event.type !== 'pr_opened') {
      await deps.dispatch(chat.id, await withPeople({ type: 'pr_opened', author: snapshot.author, reviewers: snapshot.requestedReviewers }, rules));
    }
  } else if (ne.snapshot) {
    await prisma.prChat.update({ where: { id: chat.id }, data: { title: ne.snapshot.title, body: ne.snapshot.body } });
  }

  if (event.type === 'head_updated') event = { ...event, ours: await isOurPush(chat, event.after) };
  await deps.dispatch(chat.id, event);
  return null;
}

async function createChat(repoId: string, s: PrSnapshot, rules: TeamRules): Promise<PrChat> {
  const trusted = isTrustedAssociation(s.authorAssociation) || (s.author.isBot && rules.trusted_bots.includes(s.author.login));
  return prisma.prChat.create({
    data: {
      repoId,
      number: s.ref.number,
      title: s.title,
      body: s.body,
      url: s.url,
      authorGithubId: s.author.githubId,
      headSha: s.headSha,
      baseSha: s.baseSha,
      baseRef: s.baseRef,
      headRef: s.headRef,
      headRepoFullName: s.headRepoFullName,
      isDraft: s.isDraft,
      trusted,
    },
  });
}

/** Our writes come back as webhooks; recognize them by marker or by the ids we stored (spec §15). */
async function isOwnWrite(event: DomainEvent): Promise<boolean> {
  if (event.type === 'external_comment') {
    if (containsMarker(event.comment.body)) return true;
    return (await prisma.githubWrite.count({ where: { githubId: event.comment.id } })) > 0;
  }
  if (event.type === 'external_comment_deleted') {
    return (await prisma.githubWrite.count({ where: { githubId: event.commentId } })) > 0;
  }
  if (event.type === 'external_review_submitted') {
    if (containsMarker(event.review.body)) return true;
    return (await prisma.githubWrite.count({ where: { kind: 'review', githubId: event.review.id } })) > 0;
  }
  return false;
}

/**
 * A comment can reach us twice: on its own, and inside its submitted review. Remember each
 * comment id once (SeenComment) and drop repeats. Returns null when nothing new is left.
 */
async function keepUnseenComments(event: DomainEvent): Promise<DomainEvent | null> {
  const isNew = async (commentId: string) => (await prisma.seenComment.createMany({ data: [{ commentId }], skipDuplicates: true })).count === 1;
  if (event.type === 'external_comment') return (await isNew(event.comment.id)) ? event : null;
  if (event.type === 'external_review_submitted') {
    const comments = [];
    for (const c of event.review.comments) if (await isNew(c.id)) comments.push(c);
    return { ...event, review: { ...event.review, comments } };
  }
  return event;
}

/** Our CLI announces each push with job.pushing before it happens (spec §10). */
async function isOurPush(chat: PrChat, sha: string): Promise<boolean> {
  return (await prisma.job.count({ where: { chatId: chat.id, expectedPushSha: sha } })) > 0;
}
```

`apps/server/src/ingest/handle.ts`:
```ts
import { routePrEvent, type RouterDeps } from '../chats/route-event';
import { getEnv } from '../lib/env';
import type { DeliveryHandler } from './process';
import { syncFromEvent } from './installations';

/** What happens to each stored webhook delivery: parse it, then sync installations or route PR events. */
export function createDeliveryHandler(deps: RouterDeps): DeliveryHandler {
  return async ({ deliveryId, event, body }) => {
    const payload = JSON.parse(body) as { action?: string; repository?: { private?: boolean } };
    // Hosted instance: payloads about private repos are dropped (spec §14.9).
    if (getEnv().PUBLIC_REPOS_ONLY && payload.repository?.private === true) return { status: 'ignored', note: 'private repo (public-only mode)' };

    const headers = new Headers({ 'x-github-event': event, 'x-github-delivery': deliveryId });
    const events = await deps.platform.parseWebhook(headers, body);
    if (events.length === 0) return { status: 'ignored', note: `nothing to do for ${event}${payload.action ? `.${payload.action}` : ''}` };

    const skipped: string[] = [];
    for (const ne of events) {
      if (ne.scope === 'pr') {
        const reason = await routePrEvent(ne, deps);
        if (reason) skipped.push(reason);
      } else {
        await syncFromEvent(ne);
      }
    }
    return skipped.length === events.length ? { status: 'ignored', note: skipped.join('; ') } : { status: 'processed' };
  };
}
```

- [x] **Step 9: Wire the router into the server**

In `apps/server/src/main.ts`:
- Add the imports:
```ts
import { Dispatcher } from './chats/dispatch';
import { createDeliveryHandler } from './ingest/handle';
import { GithubReads } from './platform/github/reads';
```
- Replace the temporary ingest line (and its comment) with:
```ts
  const platform = new GithubReads(github, appAuth);
  const dispatcher = new Dispatcher();
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));
```

- [x] **Step 10: Run every test**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS everywhere (router 8 and dispatcher 6 are new).

- [x] **Step 11: See a real PR become a chat**

With `npm run dev -w apps/server` and `npm run dev:tunnel` running:
1. Sign in at `http://localhost:8787`.
2. Install `nitpilot-dev` on a public sandbox repo. GitHub redirects to `/github/setup`, which syncs the repo.
3. Open a PR there and request a review from a second account that has also signed in.

Then check the database:
```bash
docker compose exec postgres psql -U nitpilot -c 'select phase, title from "PrChat";' -c 'select type, status from "Job";'
```
Expected: one chat in `reviewing` and one `review` job in `queued`. It stays queued until Plan 1b's CLI picks it up.

- [x] **Step 12: Commit**

```bash
git add apps/server
git commit -m "feat(server): dispatcher and event router: webhooks become chats, points and jobs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Milestone M5: The task runner and GitHub writes

At the end of this milestone, Plan 1a is complete. The engine's commands become GitHub writes (one summary comment, reviews and thread replies, posted as the right person) and notifications. Everything survives a restart.

### Task 24: The task runner (outbox and timers)

**Files:**
- Create: `apps/server/src/tasks/runner.ts`, `apps/server/src/tasks/runner.db.test.ts`, `apps/server/src/tasks/handlers/timer.ts`
- Create: `docs/why/outbox-and-restarts.md`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Consumes: `prisma`, `Dispatch`.
- Produces:
  - `TaskRunner` (`start()`, `stop()`, `wake()`, `tick()`, `runDue(limit?) → number`);
  - `type TaskHandler = (task: Task) => Promise<void>`, `TaskHandlers`;
  - `PermanentTaskError`, `MAX_TASK_ATTEMPTS = 5`, `backoffMs(attempt)` and `recoverRunningTasks()`;
  - `timerHandler(dispatch)`.

Spec §7: "a `Task` table and a 1-second ticker handle GitHub writes and timers". Claiming a task is the same compare-and-swap as Odyhook's `claimDelivery` (`hooksmith/src/lib/delivery-claim.ts`).

- [x] **Step 1: Write the failing tests**

`apps/server/src/tasks/runner.db.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeChat, makeRepo, resetDb } from '../../test/db';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { timerHandler } from './handlers/timer';
import { backoffMs, MAX_TASK_ATTEMPTS, PermanentTaskError, recoverRunningTasks, TaskRunner } from './runner';

beforeEach(resetDb);

const NOW = new Date('2026-10-07T18:00:00Z');
const newTask = (over: Partial<Prisma.TaskUncheckedCreateInput> = {}) => prisma.task.create({ data: { kind: 'test', payload: {}, runAt: NOW, ...over } });
const statusOf = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).status;

describe('TaskRunner', () => {
  it('runs due tasks and leaves future ones for later', async () => {
    const due = await newTask();
    const later = await newTask({ runAt: new Date(NOW.getTime() + 60_000) });
    const handler = vi.fn(async () => {});
    expect(await new TaskRunner({ test: handler }, { now: () => NOW }).runDue()).toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await statusOf(due.id)).toBe('done');
    expect(await statusOf(later.id)).toBe('pending');
  });

  it('retries a failing task with backoff, then gives up', async () => {
    const task = await newTask();
    let now = NOW;
    const runner = new TaskRunner({ test: async () => { throw new Error('GitHub 502'); } }, { now: () => now });

    await runner.runDue();
    let row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ status: 'pending', attempts: 1, lastError: 'GitHub 502' });
    expect(row.runAt).toEqual(new Date(NOW.getTime() + backoffMs(1)));

    for (let i = 2; i <= MAX_TASK_ATTEMPTS; i++) {
      now = row.runAt;
      await runner.runDue();
      row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    }
    expect(row).toMatchObject({ status: 'failed', attempts: MAX_TASK_ATTEMPTS });
  });

  it('gives up at once on a PermanentTaskError, or a kind it has no handler for', async () => {
    const permanent = await newTask();
    const unknown = await newTask({ kind: 'mystery' });
    await new TaskRunner({ test: async () => { throw new PermanentTaskError('user must sign in again'); } }, { now: () => NOW }).runDue();
    expect(await statusOf(permanent.id)).toBe('failed');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: unknown.id } })).lastError).toMatch(/no handler/);
  });

  it('leaves a task pending when it was rescheduled while running (a debounce during the write)', async () => {
    const task = await newTask({ dedupeKey: 'summary:x' });
    const later = new Date(NOW.getTime() + 5_000);
    await new TaskRunner({ test: async () => { await prisma.task.update({ where: { id: task.id }, data: { status: 'pending', runAt: later } }); } }, { now: () => NOW }).runDue();
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'pending', runAt: later });
  });

  it('never runs two passes at once', async () => {
    await newTask();
    let concurrent = 0;
    let maxConcurrent = 0;
    const runner = new TaskRunner({ test: async () => { concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); await new Promise((r) => setTimeout(r, 10)); concurrent--; } }, { now: () => NOW });
    await Promise.all([runner.tick(), runner.tick(), runner.tick()]);
    expect(maxConcurrent).toBe(1);
  });
});

describe('recoverRunningTasks', () => {
  it('makes tasks left running by a crashed process pending again', async () => {
    const task = await newTask({ status: 'running', attempts: 1 });
    expect(await recoverRunningTasks()).toBe(1);
    expect(await statusOf(task.id)).toBe('pending');
  });
});

describe('timerHandler', () => {
  it('turns a due timer into a timer event for its chat', async () => {
    const chat = await makeChat((await makeRepo()).id);
    const dispatch = vi.fn(async () => ({ chat: {} as never, timeline: [], commands: [] }));
    const task = await newTask({ kind: 'timer', chatId: chat.id, payload: { key: 'comments' } });
    await timerHandler(dispatch)(task);
    expect(dispatch).toHaveBeenCalledWith(chat.id, { type: 'timer', key: 'comments' });
  });
});
```

- [x] **Step 2: Run the tests to see them fail**

Run: `npm run test:db -w apps/server -- src/tasks`
Expected: FAIL, `Failed to resolve import "./runner"`.

- [x] **Step 3: Write the runner and the timer handler**

`apps/server/src/tasks/runner.ts`:
```ts
import type { Task } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';

export type TaskHandler = (task: Task) => Promise<void>;
export type TaskHandlers = Partial<Record<string, TaskHandler>>;

/** Throw this from a handler when trying again cannot help. */
export class PermanentTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentTaskError';
  }
}

export const MAX_TASK_ATTEMPTS = 5;

/** 5 s, 10 s, 20 s, 40 s, … capped at 10 minutes. */
export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** (attempt - 1), 10 * 60_000);
}

/**
 * Runs due Task rows: GitHub writes, notifications and timers (spec §7). Every second, and right
 * away when woken. See docs/why/outbox-and-restarts.md.
 */
export class TaskRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private again = false;

  constructor(
    private readonly handlers: TaskHandlers,
    private readonly opts: { tickMs?: number; now?: () => Date } = {},
  ) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.tick(), this.opts.tickMs ?? 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Run due tasks now instead of waiting for the next tick. */
  wake(): void {
    void this.tick();
  }

  /** One pass over due tasks. Never overlaps itself: a call during a pass asks for one more pass. */
  async tick(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.again = false;
        await this.runDue();
      } while (this.again);
    } catch (err) {
      console.error('[tasks] pass failed:', err);
    } finally {
      this.busy = false;
    }
  }

  /** Run every due task, oldest first. Returns how many ran. */
  async runDue(limit = 50): Promise<number> {
    const due = await prisma.task.findMany({
      where: { status: 'pending', runAt: { lte: this.now() } },
      orderBy: { runAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let ran = 0;
    for (const { id } of due) {
      if (await this.claim(id)) {
        await this.runOne(id);
        ran += 1;
      }
    }
    return ran;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** Compare-and-swap pending → running, so a task never runs twice at once. */
  private async claim(id: string): Promise<boolean> {
    const { count } = await prisma.task.updateMany({ where: { id, status: 'pending' }, data: { status: 'running', attempts: { increment: 1 } } });
    return count === 1;
  }

  private async runOne(id: string): Promise<void> {
    const task = await prisma.task.findUniqueOrThrow({ where: { id } });
    try {
      const handler = this.handlers[task.kind];
      if (!handler) throw new PermanentTaskError(`no handler for task kind "${task.kind}"`);
      await handler(task);
      // Only if still running: a task rescheduled meanwhile (a debounce) stays pending.
      await prisma.task.updateMany({ where: { id, status: 'running' }, data: { status: 'done', lastError: null } });
    } catch (err) {
      const lastError = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
      const final = err instanceof PermanentTaskError || task.attempts >= MAX_TASK_ATTEMPTS;
      console.error(`[tasks] ${task.kind} ${id} failed (attempt ${task.attempts}${final ? ', giving up' : ''}): ${lastError}`);
      await prisma.task.updateMany({
        where: { id, status: 'running' },
        data: final ? { status: 'failed', lastError } : { status: 'pending', lastError, runAt: new Date(this.now().getTime() + backoffMs(task.attempts)) },
      });
    }
  }
}

/** At boot: a task left `running` belonged to a process that died. Run it again; handlers are idempotent. */
export async function recoverRunningTasks(): Promise<number> {
  const { count } = await prisma.task.updateMany({ where: { status: 'running' }, data: { status: 'pending' } });
  return count;
}
```

`apps/server/src/tasks/handlers/timer.ts`:
```ts
import { z } from 'zod';
import type { Dispatch } from '../../chats/dispatch';
import { PermanentTaskError, type TaskHandler } from '../runner';

const TimerPayload = z.object({ key: z.string() });

/** A debounce or other timer came due: tell the engine (spec §9 DomainEvent `timer`). */
export function timerHandler(dispatch: Dispatch): TaskHandler {
  return async (task) => {
    const { key } = TimerPayload.parse(task.payload);
    if (!task.chatId) throw new PermanentTaskError('timer task without a chat');
    await dispatch(task.chatId, { type: 'timer', key });
  };
}
```

- [x] **Step 4: Run the tests to see them pass**

Run: `npm run test:db -w apps/server -- src/tasks && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (runner 5, recovery 1, timer 1).

- [x] **Step 5: Run timers in the server**

In `apps/server/src/main.ts`, add the imports `import { timerHandler } from './tasks/handlers/timer';` and `import { recoverRunningTasks, TaskRunner } from './tasks/runner';`. After `const dispatcher = new Dispatcher();`, add:
```ts
  const runner = new TaskRunner({ timer: timerHandler(dispatcher.dispatch) });
  dispatcher.onCommit((_chatId, effects) => {
    if (effects.tasksCreated) runner.wake();
  });
```
After `await ingest.replayReceived();`, add:
```ts
  await recoverRunningTasks();
  runner.start();
```
Add `runner.stop();` to `shutdown` after `clearInterval(purge);`.

- [x] **Step 6: Write the explainer**

`docs/why/outbox-and-restarts.md`:
```markdown
# How work survives a restart (the outbox and the Task table)

**In one sentence:** anything the server must do later (post to GitHub, send a notification, fire a 30-second debounce) is first written as a row in the `Task` table, inside the same database transaction as the change that caused it; a ticker then runs due rows.

## The problem it solves

Say the engine decides "Leo's review is done; post a summary comment". If we called GitHub right there and the server crashed a moment later, we'd lose either the database change or the GitHub write, and they'd disagree forever. Writing the intention as a row **in the same transaction** means both happen or neither does. This is the "transactional outbox" pattern.

## How it works here

1. The dispatcher (`chats/dispatch.ts`) saves the chat **and** its new `Task` rows in one transaction (`chats/apply-commands.ts`).
2. `tasks/runner.ts` wakes every second, or right after a dispatch, and claims due rows one by one. Claiming is a compare-and-swap from `pending` to `running`, the same trick as Odyhook's `claimDelivery`.
3. Success → `done`. Failure → `pending` again with a growing delay (5 s, 10 s, 20 s…), up to 5 attempts.
4. At boot, any row still `running` belonged to the crashed process, so it goes back to `pending`.

## Making "run it again" safe

A crash can happen **after** GitHub accepted a write but **before** we marked the task done. So every body we post carries a hidden marker (`lib/markers.ts`). On a retry, the GitHub adapter first looks for a write with that marker and reuses it instead of posting a duplicate (`platform/github/writes.ts`).

## Debounce and timers are tasks too

"Wait for 30 quiet seconds after the last comment" is a task with a `dedupeKey`. Each new comment moves the same row's `runAt` later instead of adding a new row. When it finally runs, it tells the engine `timer: comments`.

## The React analogy

Like an optimistic update with a persisted queue of pending mutations, but on the server: the intent is saved first, then executed and retried until it sticks.
```

- [x] **Step 7: Commit**

```bash
git add apps/server docs/why/outbox-and-restarts.md
git commit -m "feat(server): task runner with retries, debounce-safe completion and timers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 25: Output sanitizer

**Files:**
- Create: `apps/server/src/lib/sanitize.ts`, `apps/server/src/lib/sanitize.test.ts`

**Interfaces:**
- Consumes: `BRAND`.
- Produces: `sanitizeForGithub(text, { allowedMentions, maxLength }) → string`.

Spec §14.6: everything agents wrote is cleaned before it goes to GitHub.
- Secrets are redacted (`ghp_`, `sk-ant-`, `AKIA…`, PEM blocks).
- @mentions of anyone outside the PR are neutralized.
- Images and raw HTML are stripped (image URLs can leak data).
- HTML comments are removed too, so agent text can never forge our hidden marker (Review Focus #1).

- [x] **Step 1: Write the failing test**

`apps/server/src/lib/sanitize.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { sanitizeForGithub } from './sanitize';

const clean = (text: string, maxLength = 4000) => sanitizeForGithub(text, { allowedMentions: ['maya', 'Leo'], maxLength });

describe('sanitizeForGithub', () => {
  it.each([
    ['a GitHub token', `token ghp_${'a'.repeat(36)} here`],
    ['a fine-grained GitHub token', `github_pat_${'b'.repeat(30)}`],
    ['an Anthropic key', `sk-ant-api03-${'c'.repeat(40)}`],
    ['an AWS key id', 'AKIAABCDEFGHIJKLMNOP'],
    ['a Nitpilot CLI token', `nit_${'d'.repeat(43)}`],
    ['a private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----'],
  ])('redacts %s', (_label, secret) => {
    const out = clean(`before ${secret} after`);
    expect(out).toContain('[redacted]');
    expect(out).not.toContain(secret);
  });

  it('removes HTML comments, so agent text cannot forge our marker', () => {
    expect(clean('ok <!-- nitpilot:v1 chat=x --> done')).toBe('ok  done');
  });

  it('keeps an image only as its alt text', () => {
    expect(clean('see ![diagram](https://evil.example/x.png?data=secret)')).toBe('see diagram');
  });

  it('strips raw HTML tags', () => {
    expect(clean('a <img src=x onerror=alert(1)> b <b>bold</b>')).toBe('a  b bold');
  });

  it('neutralizes mentions of people outside the PR, keeps the ones inside', () => {
    expect(clean('@maya and @leo, also @someone and @acme/team')).toBe('@maya and @leo, also `@someone` and `@acme/team`');
  });

  it('leaves emails and code alone', () => {
    expect(clean('mail a@b.com or run `npm i @scope/pkg`')).toBe('mail a@b.com or run `npm i @scope/pkg`');
  });

  it('cuts long text with an ellipsis', () => {
    const out = clean('x'.repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });
});
```

- [x] **Step 2: Run the test to see it fail**

Run: `npm run test:unit -w apps/server -- src/lib/sanitize`
Expected: FAIL, `Failed to resolve import "./sanitize"`.

- [x] **Step 3: Write the sanitizer**

`apps/server/src/lib/sanitize.ts`:
```ts
import { BRAND } from '@nitpilot/protocol';

const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  new RegExp(`\\b${BRAND.tokenPrefix}[A-Za-z0-9_-]{43}`, 'g'),
];

// An @mention not preceded by a word character, backtick, slash, @ or dot (so emails and code are safe).
const MENTION = /(^|[^\w`/@.])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9_.-]+)?)/g;

export type SanitizeOptions = {
  /** Logins of the people in the PR; everyone else's mention is neutralized. */
  allowedMentions: string[];
  maxLength: number;
};

/** Make agent-written text safe to post on GitHub (spec §14.6). */
export function sanitizeForGithub(text: string, opts: SanitizeOptions): string {
  let out = text;
  for (const pattern of SECRETS) out = out.replace(pattern, '[redacted]');
  out = out.replace(/<!--[\s\S]*?-->/g, ''); // HTML comments could forge our hidden marker
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images: keep the alt text, drop the URL
  out = out.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1'); // reference-style images
  out = out.replace(/<\/?[A-Za-z][^>]*>/g, ''); // raw HTML tags

  const allowed = new Set(opts.allowedMentions.map((l) => l.toLowerCase()));
  out = out.replace(MENTION, (match, before: string, name: string) =>
    !name.includes('/') && allowed.has(name.toLowerCase()) ? match : `${before}\`@${name}\``,
  );

  return out.length > opts.maxLength ? `${out.slice(0, opts.maxLength - 1)}…` : out;
}
```

- [x] **Step 4: Run the test to see it pass**

Run: `npm run test:unit -w apps/server -- src/lib/sanitize && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (12 tests).

- [x] **Step 5: Commit**

```bash
git add apps/server/src/lib
git commit -m "feat(server): sanitize agent text before it reaches GitHub

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 26: GitHub writes and the full GitHub adapter

**Files:**
- Create: `apps/server/src/platform/github/writes.ts`, `apps/server/src/platform/github/writes.test.ts`, `apps/server/src/platform/github/platform.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Consumes: `GithubClient`, `GithubError`, `AppAuth`, `GithubReads`, `getUserToken`.
- Produces:
  - `WriteContext = { github, appAuth, userToken(userId) }`;
  - `upsertSummary(ctx, pr, body, existingId?, opts?)`, `postReview(ctx, asUser, pr, r, opts?)` and `replyToThread(ctx, asUser, pr, threadRootId, body, opts?)`;
  - `class GithubPlatform extends GithubReads implements PlatformAdapter`.

Spec §15 "Who writes":
- The summary comes from the app bot (installation token).
- Reviews and thread replies come from the user (user token), so GitHub shows their avatar plus the app badge.
- Reviews are posted as `COMMENT` and are never approvals.
- Replies to a conversation comment (`issue:…`) or a review body (`review:…`) become new PR comments, because those have no threads on GitHub.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/platform/github/writes.test.ts`:
```ts
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch, json } from '../../../test/fake-fetch';
import { AppAuth } from './app-auth';
import { GithubClient } from './client';
import { postReview, replyToThread, upsertSummary, type WriteContext } from './writes';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const pr = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const fetch = fakeFetch({ 'POST /app/installations/77/access_tokens': () => ({ token: 'ghs_bot', expires_at: '2099-01-01T00:00:00Z' }), ...routes });
  const github = new GithubClient(fetch);
  const ctx: WriteContext = { github, appAuth: new AppAuth(github, '12345', pem), userToken: async (userId) => `ghu_${userId}` };
  return { fetch, ctx, calls: (route: string) => fetch.calls.filter((c) => `${c.method} ${c.url.pathname}` === route) };
}

describe('upsertSummary', () => {
  it('posts a new comment as the app bot', async () => {
    const { ctx, calls } = setup({ 'POST /repos/octo/sandbox/issues/42/comments': () => ({ id: 555 }) });
    expect(await upsertSummary(ctx, pr, 'summary')).toEqual({ id: '555' });
    expect(calls('POST /repos/octo/sandbox/issues/42/comments')[0]!.headers.get('authorization')).toBe('Bearer ghs_bot');
  });

  it('edits the existing comment in place', async () => {
    const { ctx, calls } = setup({ 'PATCH /repos/octo/sandbox/issues/comments/555': () => ({ id: 555 }) });
    expect(await upsertSummary(ctx, pr, 'v2', '555')).toEqual({ id: '555' });
    expect(calls('PATCH /repos/octo/sandbox/issues/comments/555')[0]!.body).toEqual({ body: 'v2' });
  });

  it('posts a new one when someone deleted the old comment', async () => {
    const { ctx } = setup({
      'PATCH /repos/octo/sandbox/issues/comments/555': () => json({ message: 'Not Found' }, 404),
      'POST /repos/octo/sandbox/issues/42/comments': () => ({ id: 556 }),
    });
    expect(await upsertSummary(ctx, pr, 'v2', '555')).toEqual({ id: '556' });
  });

  it('on a retry, reuses the comment that already carries the marker (Review Focus #2)', async () => {
    const { ctx, calls } = setup({
      'GET /repos/octo/sandbox/issues/42/comments': () => [{ id: 1, body: 'hello' }, { id: 557, body: '<!-- nitpilot:v1 chat=c1 -->\nold' }],
      'PATCH /repos/octo/sandbox/issues/comments/557': () => ({ id: 557 }),
    });
    expect(await upsertSummary(ctx, pr, 'new', undefined, { reuseIfContains: '<!-- nitpilot:v1 chat=c1 -->' })).toEqual({ id: '557' });
    expect(calls('POST /repos/octo/sandbox/issues/42/comments')).toEqual([]);
  });
});

describe('postReview', () => {
  const review = {
    commitSha: 'c'.repeat(40),
    body: 'Review <!-- m -->',
    comments: [{ path: 'src/ordres été/list v2.ts', line: 48, side: 'RIGHT' as const, body: 'P1', diffRefs: { base: 'b', head: 'c' } }],
  };

  it('posts one COMMENT review as the user and returns its comment ids in order', async () => {
    const { ctx, calls } = setup({
      'POST /repos/octo/sandbox/pulls/42/reviews': () => ({ id: 900 }),
      'GET /repos/octo/sandbox/pulls/42/reviews/900/comments': () => [{ id: 12 }, { id: 11 }],
    });
    expect(await postReview(ctx, 'user-leo', pr, review)).toEqual({ reviewId: '900', commentIds: ['11', '12'] });
    const post = calls('POST /repos/octo/sandbox/pulls/42/reviews')[0]!;
    expect(post.headers.get('authorization')).toBe('Bearer ghu_user-leo');
    // The path goes through exactly as given (Review Focus #5).
    expect(post.body).toEqual({ commit_id: 'c'.repeat(40), body: 'Review <!-- m -->', event: 'COMMENT', comments: [{ path: 'src/ordres été/list v2.ts', line: 48, side: 'RIGHT', body: 'P1' }] });
  });

  it('on a retry, reuses a review that already carries the marker (Review Focus #2)', async () => {
    const { ctx, calls } = setup({
      'GET /repos/octo/sandbox/pulls/42/reviews': () => [{ id: 901, body: 'Review <!-- m -->' }],
      'GET /repos/octo/sandbox/pulls/42/reviews/901/comments': () => [{ id: 21 }],
    });
    expect(await postReview(ctx, 'user-leo', pr, review, { reuseIfContains: '<!-- m -->' })).toEqual({ reviewId: '901', commentIds: ['21'] });
    expect(calls('POST /repos/octo/sandbox/pulls/42/reviews')).toEqual([]);
  });
});

describe('replyToThread', () => {
  it('replies in a review comment thread as the user', async () => {
    const { ctx, calls } = setup({ 'POST /repos/octo/sandbox/pulls/42/comments/9001/replies': () => ({ id: 77 }) });
    expect(await replyToThread(ctx, 'user-maya', pr, '9001', 'Fixed.')).toEqual({ id: '77' });
    expect(calls('POST /repos/octo/sandbox/pulls/42/comments/9001/replies')[0]!.headers.get('authorization')).toBe('Bearer ghu_user-maya');
  });

  it('answers a conversation comment with a new PR comment', async () => {
    const { ctx } = setup({ 'POST /repos/octo/sandbox/issues/42/comments': () => ({ id: 78 }) });
    expect(await replyToThread(ctx, 'user-maya', pr, 'issue:8001', 'Done.')).toEqual({ id: 'issue:78' });
  });

  it('on a retry, reuses a reply that already carries the marker', async () => {
    const { ctx, calls } = setup({ 'GET /repos/octo/sandbox/pulls/42/comments': () => [{ id: 79, in_reply_to_id: 9001, body: 'Fixed. <!-- r -->' }] });
    expect(await replyToThread(ctx, 'user-maya', pr, '9001', 'Fixed. <!-- r -->', { reuseIfContains: '<!-- r -->' })).toEqual({ id: '79' });
    expect(calls('POST /repos/octo/sandbox/pulls/42/comments/9001/replies')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run test:unit -w apps/server -- src/platform/github/writes`
Expected: FAIL, `Failed to resolve import "./writes"`.

- [ ] **Step 3: Write the writes**

`apps/server/src/platform/github/writes.ts`:
```ts
import type { AnchoredComment, PrRef, WriteOptions } from '../types';
import type { AppAuth } from './app-auth';
import { GithubError, type GithubClient } from './client';

export type WriteContext = {
  github: GithubClient;
  appAuth: AppAuth;
  /** The user's GitHub token (auth/user-tokens.ts). Throws NeedsReauthError when they must sign in again. */
  userToken: (userId: string) => Promise<string>;
};

const repoPath = (pr: PrRef) => `/repos/${pr.repoFullName}`;

/** The summary comment, as the app bot (spec §15). Edited in place; recreated if someone deleted it. */
export async function upsertSummary(ctx: WriteContext, pr: PrRef, body: string, existingId?: string, opts: WriteOptions = {}): Promise<{ id: string }> {
  const token = await ctx.appAuth.installationToken(pr.installationId);
  const edit = async (id: string) => {
    await ctx.github.api('PATCH', `${repoPath(pr)}/issues/comments/${id}`, { token, body: { body } });
    return { id };
  };

  if (existingId) {
    try {
      return await edit(existingId);
    } catch (err) {
      if (!(err instanceof GithubError && err.status === 404)) throw err;
    }
  }
  if (opts.reuseIfContains) {
    const found = await findIssueComment(ctx, token, pr, opts.reuseIfContains);
    if (found) return edit(found);
  }
  const { data } = await ctx.github.api<{ id: number }>('POST', `${repoPath(pr)}/issues/${pr.number}/comments`, { token, body: { body } });
  return { id: String(data.id) };
}

/** One review with inline comments, as the user. Always COMMENT: approving stays a human act. */
export async function postReview(
  ctx: WriteContext,
  asUser: string,
  pr: PrRef,
  r: { commitSha: string; body: string; comments: AnchoredComment[] },
  opts: WriteOptions = {},
): Promise<{ reviewId: string; commentIds: string[] }> {
  const token = await ctx.userToken(asUser);
  if (opts.reuseIfContains) {
    const { data: reviews } = await ctx.github.api<{ id: number; body: string | null }[]>('GET', `${repoPath(pr)}/pulls/${pr.number}/reviews?per_page=100`, { token });
    const existing = reviews.find((rv) => rv.body?.includes(opts.reuseIfContains!));
    if (existing) return { reviewId: String(existing.id), commentIds: await reviewCommentIds(ctx, token, pr, existing.id) };
  }
  const { data } = await ctx.github.api<{ id: number }>('POST', `${repoPath(pr)}/pulls/${pr.number}/reviews`, {
    token,
    body: {
      commit_id: r.commitSha,
      body: r.body,
      event: 'COMMENT',
      comments: r.comments.map((c) => ({ path: c.path, line: c.line, side: c.side, body: c.body })),
    },
  });
  return { reviewId: String(data.id), commentIds: await reviewCommentIds(ctx, token, pr, data.id) };
}

/** A reply where the point was raised, as the user (spec §6.1). */
export async function replyToThread(ctx: WriteContext, asUser: string, pr: PrRef, threadRootId: string, body: string, opts: WriteOptions = {}): Promise<{ id: string }> {
  const token = await ctx.userToken(asUser);

  // Conversation comments and review bodies have no threads on GitHub: answer with a new PR comment.
  if (threadRootId.startsWith('issue:') || threadRootId.startsWith('review:')) {
    const found = opts.reuseIfContains ? await findIssueComment(ctx, token, pr, opts.reuseIfContains) : null;
    if (found) return { id: `issue:${found}` };
    const { data } = await ctx.github.api<{ id: number }>('POST', `${repoPath(pr)}/issues/${pr.number}/comments`, { token, body: { body } });
    return { id: `issue:${data.id}` };
  }

  if (opts.reuseIfContains) {
    const { data } = await ctx.github.api<{ id: number; in_reply_to_id?: number; body: string }[]>('GET', `${repoPath(pr)}/pulls/${pr.number}/comments?per_page=100`, { token });
    const found = data.find((c) => String(c.in_reply_to_id) === threadRootId && c.body.includes(opts.reuseIfContains!));
    if (found) return { id: String(found.id) };
  }
  const { data } = await ctx.github.api<{ id: number }>('POST', `${repoPath(pr)}/pulls/${pr.number}/comments/${threadRootId}/replies`, { token, body: { body } });
  return { id: String(data.id) };
}

/** The ids of a review's inline comments, oldest first, which is the order we sent them. */
async function reviewCommentIds(ctx: WriteContext, token: string, pr: PrRef, reviewId: number): Promise<string[]> {
  const { data } = await ctx.github.api<{ id: number }[]>('GET', `${repoPath(pr)}/pulls/${pr.number}/reviews/${reviewId}/comments?per_page=100`, { token });
  return data.map((c) => c.id).sort((a, b) => a - b).map(String);
}

/** Looks through the first 100 PR comments for one carrying `marker`. */
async function findIssueComment(ctx: WriteContext, token: string, pr: PrRef, marker: string): Promise<string | null> {
  const { data } = await ctx.github.api<{ id: number; body: string | null }[]>('GET', `${repoPath(pr)}/issues/${pr.number}/comments?per_page=100`, { token });
  const found = data.find((c) => c.body?.includes(marker));
  return found ? String(found.id) : null;
}
```

`apps/server/src/platform/github/platform.ts`:
```ts
import type { AnchoredComment, PlatformAdapter, PrRef, WriteOptions } from '../types';
import type { AppAuth } from './app-auth';
import type { GithubClient } from './client';
import { GithubReads } from './reads';
import { postReview, replyToThread, upsertSummary, type WriteContext } from './writes';

/** The complete GitHub adapter (spec §12.1): reads, webhook parsing and writes. */
export class GithubPlatform extends GithubReads implements PlatformAdapter {
  private readonly writeCtx: WriteContext;

  constructor(github: GithubClient, appAuth: AppAuth, userToken: (userId: string) => Promise<string>) {
    super(github, appAuth);
    this.writeCtx = { github, appAuth, userToken };
  }

  upsertSummary(pr: PrRef, body: string, existingId?: string, opts?: WriteOptions) {
    return upsertSummary(this.writeCtx, pr, body, existingId, opts);
  }

  postReview(asUser: string, pr: PrRef, r: { commitSha: string; body: string; comments: AnchoredComment[] }, opts?: WriteOptions) {
    return postReview(this.writeCtx, asUser, pr, r, opts);
  }

  replyToThread(asUser: string, pr: PrRef, threadRootId: string, body: string, opts?: WriteOptions) {
    return replyToThread(this.writeCtx, asUser, pr, threadRootId, body, opts);
  }
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm run test:unit -w apps/server -- src/platform && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (writes 9, plus the earlier platform tests).

- [ ] **Step 5: Use the full adapter in the server**

In `apps/server/src/main.ts`:
- Replace `import { GithubReads } from './platform/github/reads';` with `import { GithubPlatform } from './platform/github/platform';` and add `import { getUserToken } from './auth/user-tokens';`.
- Replace `const platform = new GithubReads(github, appAuth);` with:
```ts
  const platform = new GithubPlatform(github, appAuth, (userId) => getUserToken(userId, github));
```

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): GitHub writes (summary as bot, reviews and replies as the user) with retry-safe reuse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 27: Task handlers: summary, review, replies and notifications

**Files:**
- Create: `apps/server/src/tasks/notifier.ts`, `apps/server/src/tasks/handlers/shared.ts`, `apps/server/src/tasks/handlers/summary.ts`, `apps/server/src/tasks/handlers/review.ts`, `apps/server/src/tasks/handlers/replies.ts`, `apps/server/src/tasks/handlers/notify.ts`, `apps/server/src/tasks/handlers/index.ts`, `apps/server/src/tasks/handlers/handlers.db.test.ts`
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Consumes: `PlatformWrites`, `renderSummary`, `sanitizeForGithub`, the markers, `prRefOf`, `transcriptUrl`, `NeedsReauthError`, `TaskHandler`, `PermanentTaskError`.
- Produces:
  - `Notifier` (`notify(n)`), `Notification` and `LogNotifier`;
  - `notificationTitle(kind, pr, points)`;
  - `summaryHandler`, `reviewHandler`, `repliesHandler` and `notifyHandler`;
  - `createTaskHandlers({ platform, notifier, dispatch }) → TaskHandlers`.
- Plan 1b replaces `LogNotifier` with a notifier that sends `notify` to the user's CLI.

Rules covered:
- **§15 summary:** created after the first agent round, edited in place, skipped when the content hash didn't change, and capped at 60,000 characters.
- **§15 reviews:** one review per pass, ≤ 20 points, each ≤ 4,000 characters.
- **§16:** what to notify.
- **Review Focus #2:** a retry (`attempts > 1`) reuses earlier writes.
- **§15 lost token:** a user who must sign in again stops writes in their name; Nitpilot never posts as the bot instead.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/tasks/handlers/handlers.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { ghId, makeChat, makeRepo, makeUser, resetDb } from '../../../test/db';
import type { Prisma } from '../../generated/prisma/client';
import { prRefOf } from '../../chats/refs';
import { summaryMarker } from '../../lib/markers';
import { prisma } from '../../lib/prisma';
import { FakePlatform } from '../../platform/fake/fake-platform';
import type { Notification } from '../notifier';
import { createTaskHandlers } from './index';

beforeEach(resetDb);

async function scene(opts: { authorOnNitpilot: boolean }) {
  const maya = opts.authorOnNitpilot ? await makeUser({ login: 'maya' }) : null;
  const leo = await makeUser({ login: 'leo' });
  const mayaGithubId = maya?.githubId ?? ghId();
  const repo = await makeRepo();
  const chat = await makeChat(repo.id, { authorGithubId: mayaGithubId });
  await prisma.participant.createMany({
    data: [
      { chatId: chat.id, githubId: mayaGithubId, role: 'author', login: 'maya', userId: maya?.id ?? null },
      { chatId: chat.id, githubId: leo.githubId, role: 'reviewer', login: 'leo', userId: leo.id, requested: true },
    ],
  });
  const platform = new FakePlatform();
  const sent: Notification[] = [];
  const handlers = createTaskHandlers({ platform, notifier: { notify: async (n) => { sent.push(n); } }, dispatch: async () => { throw new Error('not used'); } });
  const ref = prRefOf(await prisma.prChat.findUniqueOrThrow({ where: { id: chat.id }, include: { repo: true } }));
  const point = (number: number, over: Partial<Prisma.PointUncheckedCreateInput> = {}) =>
    prisma.point.create({ data: { chatId: chat.id, number, raisedByGithubId: leo.githubId, origin: 'agent', severity: 'major', category: 'bug', title: `Point ${number}`, body: 'Explanation.', round: 1, path: 'src/a.ts', line: 10, side: 'RIGHT', commitSha: 'a'.repeat(40), ...over } });
  const task = (kind: string, payload: Prisma.InputJsonValue, attempts = 1) => prisma.task.create({ data: { kind, chatId: chat.id, payload, status: 'running', attempts } });
  return { maya, leo, repo, chat, platform, sent, handlers, ref, point, task };
}

describe('summary', () => {
  it('posts one summary, then edits it only when the content changes', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await prisma.prChat.update({ where: { id: s.chat.id }, data: { phase: 'ready', round: 2 } });
    await s.point(1, { status: 'resolved', authorResolution: 'fixed' });
    await prisma.message.create({ data: { chatId: s.chat.id, seq: 1, kind: 'point_reply', pointNumber: 1, body: 'Added the check.', data: { resolution: 'fixed', commit: 'c0ffee1234' } } });

    await s.handlers.summary!(await s.task('summary', {}));
    const [summary] = s.platform.writesFor(s.ref, 'summary');
    expect(summary!.body.startsWith(summaryMarker(s.chat.id))).toBe(true);
    expect(summary!.body).toContain('ready for approval');
    expect(summary!.body).toContain('fixed in c0ffee1');
    const chat = await prisma.prChat.findUniqueOrThrow({ where: { id: s.chat.id } });
    expect(chat.summaryCommentId).toBe(summary!.id);
    expect(await prisma.githubWrite.count({ where: { kind: 'summary', githubId: `issue:${summary!.id}` } })).toBe(1);

    await s.handlers.summary!(await s.task('summary', {}));
    expect(summary!.edits).toBe(0);

    await s.point(2, { title: 'New point' });
    await s.handlers.summary!(await s.task('summary', {}));
    expect(s.platform.writesFor(s.ref, 'summary')).toHaveLength(1);
    expect(summary!.edits).toBe(1);
  });

  it('after a crash, finds the summary it already posted instead of posting another (Review Focus #2)', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await s.point(1);
    await s.platform.upsertSummary(s.ref, `${summaryMarker(s.chat.id)}\nolder version`);
    await s.handlers.summary!(await s.task('summary', {}, 2));
    expect(s.platform.writesFor(s.ref, 'summary')).toHaveLength(1);
  });
});

describe('post_review (single-player reviewer)', () => {
  it("posts the points as one review in leo's name and links each point to its GitHub thread", async () => {
    const s = await scene({ authorOnNitpilot: false });
    await s.point(1);
    await s.point(2, { path: null, line: null, title: 'General: needs tests' });
    await s.handlers.post_review!(await s.task('post_review', { reviewerGithubId: s.leo.githubId, pointNumbers: [1, 2] }));

    const [review] = s.platform.writesFor(s.ref, 'review');
    expect(review!.asUser).toBe(s.leo.id);
    expect(review!.comments).toEqual([expect.objectContaining({ path: 'src/a.ts', line: 10, side: 'RIGHT' })]);
    expect(review!.body).toContain('General: needs tests');
    const p1 = await prisma.point.findFirstOrThrow({ where: { chatId: s.chat.id, number: 1 } });
    expect(p1.githubCommentId).toBe(review!.commentIds[0]);
    expect(p1.githubThreadRootId).toBe(review!.commentIds[0]);
    expect(await prisma.githubWrite.count({ where: { chatId: s.chat.id } })).toBe(2);
  });

  it('falls back to a review without inline comments when GitHub rejects a line', async () => {
    const s = await scene({ authorOnNitpilot: false });
    await s.point(1);
    s.platform.rejectNextInlineReview = true;
    await s.handlers.post_review!(await s.task('post_review', { reviewerGithubId: s.leo.githubId, pointNumbers: [1] }));
    const [review] = s.platform.writesFor(s.ref, 'review');
    expect(review!.comments).toEqual([]);
    expect(review!.body).toContain('Point 1');
    expect((await prisma.point.findFirstOrThrow({ where: { chatId: s.chat.id, number: 1 } })).githubCommentId).toBeNull();
  });

  it('cleans agent text before posting', async () => {
    const s = await scene({ authorOnNitpilot: false });
    await s.point(1, { body: `Leaked ghp_${'a'.repeat(36)}; ask @someone or @maya. ![x](https://evil.example/p.png)` });
    await s.handlers.post_review!(await s.task('post_review', { reviewerGithubId: s.leo.githubId, pointNumbers: [1] }));
    const body = s.platform.writesFor(s.ref, 'review')[0]!.comments[0]!.body;
    expect(body).toContain('[redacted]');
    expect(body).toContain('`@someone`');
    expect(body).toContain('@maya');
    expect(body).not.toContain('evil.example');
  });
});

describe('thread_replies', () => {
  it('replies in each point thread, and skips points that have none', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await s.point(1, { origin: 'github', githubCommentId: '9001', githubThreadRootId: '9001' });
    await s.point(2);
    await s.handlers.thread_replies!(await s.task('thread_replies', { asGithubId: s.maya!.githubId, replies: [{ pointNumber: 1, body: 'Fixed in c0ffee1.' }, { pointNumber: 2, body: 'x' }] }));
    const replies = s.platform.writesFor(s.ref, 'reply');
    expect(replies).toEqual([expect.objectContaining({ asUser: s.maya!.id, threadRootId: '9001' })]);
    expect(replies[0]!.body).toMatch(/^Fixed in c0ffee1\.\n\n<!-- nitpilot:v1 chat=.* point=1 -->$/);
    expect(await prisma.githubWrite.count({ where: { kind: 'reply', githubId: replies[0]!.id } })).toBe(1);
  });
});

describe('notify', () => {
  it('sends a titled notification with a link to the chat', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await s.handlers.notify!(await s.task('notify', { userIds: [s.leo.id], kind: 'ready', pointNumbers: [] }));
    expect(s.sent).toEqual([
      { userIds: [s.leo.id], kind: 'ready', chatId: s.chat.id, title: `Ready for your approval: ${s.repo.fullName}#${s.chat.number}`, url: `http://localhost:8787/c/${s.repo.fullName}/${s.chat.number}` },
    ]);
  });

  it('names the points that need a decision', async () => {
    const s = await scene({ authorOnNitpilot: true });
    await s.handlers.notify!(await s.task('notify', { userIds: [s.leo.id], kind: 'escalated', pointNumbers: [1, 3] }));
    expect(s.sent[0]!.title).toBe(`Needs you: ${s.repo.fullName}#${s.chat.number}: P1, P3 need a human decision`);
  });
});

describe('a chat that no longer exists', () => {
  it('is a quiet no-op', async () => {
    const s = await scene({ authorOnNitpilot: true });
    const t = await s.task('summary', {});
    await prisma.prChat.delete({ where: { id: s.chat.id } });
    await expect(s.handlers.summary!({ ...t, chatId: s.chat.id })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm run test:db -w apps/server -- src/tasks/handlers`
Expected: FAIL, `Failed to resolve import "./index"`.

- [ ] **Step 3: Write the notifier and the shared helpers**

`apps/server/src/tasks/notifier.ts`:
```ts
import type { NotifyKind } from '@nitpilot/protocol';

export type Notification = { userIds: string[]; kind: NotifyKind; chatId: string; title: string; url: string };

export interface Notifier {
  notify(n: Notification): Promise<void>;
}

/** Plan 1a writes notifications to the server log. Plan 1b sends them to each user's CLI. */
export class LogNotifier implements Notifier {
  async notify(n: Notification): Promise<void> {
    console.log(`[notify] ${n.kind} → ${n.userIds.join(', ')}: ${n.title} (${n.url})`);
  }
}
```

`apps/server/src/tasks/handlers/shared.ts`:
```ts
import { NeedsReauthError } from '../../auth/user-tokens';
import { prisma } from '../../lib/prisma';
import { sanitizeForGithub } from '../../lib/sanitize';
import { PermanentTaskError } from '../runner';

/** The chat a task belongs to, with what writes need. Null if it was deleted meanwhile. */
export async function chatForTask(chatId: string | null) {
  if (!chatId) return null;
  return prisma.prChat.findUnique({ where: { id: chatId }, include: { repo: true, participants: true } });
}

/** Clean agent text, letting through mentions of the people in this PR only. */
export function cleanerFor(chat: { participants: { login: string }[] }) {
  const logins = chat.participants.map((p) => p.login);
  return (text: string, maxLength: number) => sanitizeForGithub(text, { allowedMentions: logins, maxLength });
}

/** The Nitpilot account of a GitHub user, or a permanent failure: we only post as people who use Nitpilot. */
export async function nitpilotUserId(githubId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { githubId } });
  if (!user) throw new PermanentTaskError(`GitHub user ${githubId} does not use Nitpilot`);
  return user.id;
}

/** Writes in a user's name stop when their GitHub sign-in expired (spec §15); retrying can't help. */
export async function asUser<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof NeedsReauthError) throw new PermanentTaskError(`${err.message}; writes in their name are paused until they sign in again`);
    throw err;
  }
}
```

- [ ] **Step 4: Write the four handlers and the index**

`apps/server/src/tasks/handlers/summary.ts`:
```ts
import type { EscalationReason, Phase, PointStatus, Resolution } from '@nitpilot/protocol';
import { prRefOf } from '../../chats/refs';
import { renderSummary } from '../../engine/summary';
import { summaryMarker } from '../../lib/markers';
import { prisma } from '../../lib/prisma';
import { transcriptUrl } from '../../lib/urls';
import type { PlatformWrites } from '../../platform/types';
import type { TaskHandler } from '../runner';
import { chatForTask, cleanerFor } from './shared';

/** Create or edit the one summary comment (spec §15). */
export function summaryHandler(deps: { platform: PlatformWrites }): TaskHandler {
  return async (task) => {
    const chat = await chatForTask(task.chatId);
    if (!chat) return;
    const points = await prisma.point.findMany({ where: { chatId: chat.id }, orderBy: { number: 'asc' } });
    // The author agent's latest reply per point: its commit ("fixed in …") and its words.
    const replies = await prisma.message.findMany({ where: { chatId: chat.id, kind: 'point_reply' }, orderBy: { seq: 'asc' } });
    const lastReply = new Map(replies.map((m) => [m.pointNumber, { body: m.body, commit: (m.data as { commit?: string | null } | null)?.commit ?? null }]));
    const clean = cleanerFor(chat);

    const { body, hash } = renderSummary(
      {
        chatId: chat.id,
        phase: chat.phase as Phase,
        merged: chat.merged,
        round: chat.round,
        transcriptUrl: transcriptUrl(chat.repo.fullName, chat.number),
        points: points.map((p) => ({
          number: p.number,
          title: p.title,
          status: p.status as PointStatus,
          authorResolution: p.authorResolution as Resolution | null,
          escalationReason: p.escalationReason as EscalationReason | null,
          fixedIn: lastReply.get(p.number)?.commit ?? null,
          authorComment: lastReply.get(p.number)?.body ?? null,
        })),
      },
      (text) => clean(text, 4000),
    );
    if (hash === chat.summaryHash) return; // nothing changed: no GitHub request

    const reuse = task.attempts > 1 ? { reuseIfContains: summaryMarker(chat.id) } : undefined;
    const { id } = await deps.platform.upsertSummary(prRefOf(chat), body, chat.summaryCommentId ?? undefined, reuse);
    await prisma.$transaction([
      prisma.prChat.update({ where: { id: chat.id }, data: { summaryCommentId: id, summaryHash: hash } }),
      prisma.githubWrite.createMany({ data: [{ chatId: chat.id, kind: 'summary', githubId: `issue:${id}` }], skipDuplicates: true }),
    ]);
  };
}
```

`apps/server/src/tasks/handlers/review.ts`:
```ts
import { BRAND, type Side } from '@nitpilot/protocol';
import { z } from 'zod';
import { prRefOf } from '../../chats/refs';
import type { Point } from '../../generated/prisma/client';
import { writeMarker } from '../../lib/markers';
import { prisma } from '../../lib/prisma';
import { GithubError } from '../../platform/github/client';
import type { PlatformWrites } from '../../platform/types';
import type { TaskHandler } from '../runner';
import { asUser, chatForTask, cleanerFor, nitpilotUserId } from './shared';

const Payload = z.object({ reviewerGithubId: z.string(), pointNumbers: z.array(z.number().int()) });
type Clean = (text: string, maxLength: number) => string;

const pointText = (p: Point, clean: Clean) => `**P${p.number} · ${p.severity} · ${p.category}:** ${clean(p.title, 200)}\n\n${clean(p.body, 4000)}`;

/** Single-player reviewer: post the agent's points as one GitHub review, as the reviewer (spec §6.1). */
export function reviewHandler(deps: { platform: PlatformWrites }): TaskHandler {
  return async (task) => {
    const { reviewerGithubId, pointNumbers } = Payload.parse(task.payload);
    const chat = await chatForTask(task.chatId);
    if (!chat) return;
    const userId = await nitpilotUserId(reviewerGithubId);
    const login = chat.participants.find((p) => p.githubId === reviewerGithubId)?.login ?? 'reviewer';
    const points = await prisma.point.findMany({ where: { chatId: chat.id, number: { in: pointNumbers } }, orderBy: { number: 'asc' } });
    const clean = cleanerFor(chat);
    const marker = writeMarker(chat.id, task.id);
    const header = `🤖 Review by ${login}'s agent · ${BRAND.name}`;
    const commitSha = points[0]?.commitSha ?? chat.headSha;
    const reuse = task.attempts > 1 ? { reuseIfContains: marker } : undefined;
    const bodyWith = (inBody: Point[]) => [header, ...inBody.map((p) => pointText(p, clean)), marker].join('\n\n');

    let inline = points.filter((p) => p.path && p.line);
    let result: { reviewId: string; commentIds: string[] };
    try {
      result = await asUser(() =>
        deps.platform.postReview(
          userId,
          prRefOf(chat),
          {
            commitSha,
            body: bodyWith(points.filter((p) => !inline.includes(p))),
            comments: inline.map((p) => ({
              path: p.path!,
              line: p.line!,
              side: (p.side ?? 'RIGHT') as Side,
              body: `${pointText(p, clean)}\n\n${writeMarker(chat.id, task.id, p.number)}`,
              diffRefs: { base: chat.baseSha, head: commitSha },
            })),
          },
          reuse,
        ),
      );
    } catch (err) {
      if (!(err instanceof GithubError && err.status === 422)) throw err;
      // GitHub refuses inline comments on lines outside the diff: put every point in the review body.
      inline = [];
      result = await asUser(() => deps.platform.postReview(userId, prRefOf(chat), { commitSha, body: bodyWith(points), comments: [] }, reuse));
    }

    await prisma.$transaction(async (tx) => {
      await tx.githubWrite.createMany({
        data: [{ chatId: chat.id, kind: 'review', githubId: result.reviewId }, ...result.commentIds.map((id) => ({ chatId: chat.id, kind: 'review_comment', githubId: id }))],
        skipDuplicates: true,
      });
      // Each inline point now lives in a GitHub thread; replies there will find it.
      for (const [i, p] of inline.entries()) {
        const commentId = result.commentIds[i];
        if (commentId) await tx.point.update({ where: { id: p.id }, data: { githubCommentId: commentId, githubThreadRootId: commentId } });
      }
    });
  };
}
```

`apps/server/src/tasks/handlers/replies.ts`:
```ts
import { z } from 'zod';
import { prRefOf } from '../../chats/refs';
import { writeMarker } from '../../lib/markers';
import { prisma } from '../../lib/prisma';
import type { PlatformWrites } from '../../platform/types';
import type { TaskHandler } from '../runner';
import { asUser, chatForTask, cleanerFor, nitpilotUserId } from './shared';

const Payload = z.object({ asGithubId: z.string(), replies: z.array(z.object({ pointNumber: z.number().int(), body: z.string() })) });

/** Answer points where they were raised: in their GitHub threads, as the agent's owner (spec §6.1). */
export function repliesHandler(deps: { platform: PlatformWrites }): TaskHandler {
  return async (task) => {
    const { asGithubId, replies } = Payload.parse(task.payload);
    const chat = await chatForTask(task.chatId);
    if (!chat) return;
    const userId = await nitpilotUserId(asGithubId);
    const clean = cleanerFor(chat);
    const points = await prisma.point.findMany({ where: { chatId: chat.id, number: { in: replies.map((r) => r.pointNumber) } } });

    for (const reply of replies) {
      const rootId = points.find((p) => p.number === reply.pointNumber)?.githubThreadRootId;
      if (!rootId) continue;
      const marker = writeMarker(chat.id, task.id, reply.pointNumber);
      const reuse = task.attempts > 1 ? { reuseIfContains: marker } : undefined;
      const { id } = await asUser(() => deps.platform.replyToThread(userId, prRefOf(chat), rootId, `${clean(reply.body, 4000)}\n\n${marker}`, reuse));
      await prisma.githubWrite.createMany({ data: [{ chatId: chat.id, kind: 'reply', githubId: id }], skipDuplicates: true });
    }
  };
}
```

`apps/server/src/tasks/handlers/notify.ts`:
```ts
import { NotifyKind } from '@nitpilot/protocol';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { transcriptUrl } from '../../lib/urls';
import type { Notifier } from '../notifier';
import type { TaskHandler } from '../runner';

const Payload = z.object({ userIds: z.array(z.string()), kind: NotifyKind, pointNumbers: z.array(z.number().int()) });

/** Copy from the design handoff's push notifications. */
export function notificationTitle(kind: NotifyKind, pr: string, points: number[]): string {
  const list = points.map((n) => `P${n}`).join(', ');
  switch (kind) {
    case 'ready':
      return `Ready for your approval: ${pr}`;
    case 'escalated':
      return `Needs you: ${pr}: ${list} need${points.length === 1 ? 's' : ''} a human decision`;
    case 'manual_review':
      return `Review waiting: ${pr} is from an outside contributor`;
    case 'failed':
      return `Agent failed: ${pr}`;
    case 'drafts':
      return `Drafts waiting: ${pr}`;
  }
}

/** Tell people they're needed (spec §16). */
export function notifyHandler(deps: { notifier: Notifier }): TaskHandler {
  return async (task) => {
    const { userIds, kind, pointNumbers } = Payload.parse(task.payload);
    if (!task.chatId) return;
    const chat = await prisma.prChat.findUnique({ where: { id: task.chatId }, include: { repo: true } });
    if (!chat) return;
    await deps.notifier.notify({
      userIds,
      kind,
      chatId: chat.id,
      title: notificationTitle(kind, `${chat.repo.fullName}#${chat.number}`, pointNumbers),
      url: transcriptUrl(chat.repo.fullName, chat.number),
    });
  };
}
```

`apps/server/src/tasks/handlers/index.ts`:
```ts
import type { Dispatch } from '../../chats/dispatch';
import type { PlatformWrites } from '../../platform/types';
import type { Notifier } from '../notifier';
import type { TaskHandlers } from '../runner';
import { notifyHandler } from './notify';
import { repliesHandler } from './replies';
import { reviewHandler } from './review';
import { summaryHandler } from './summary';
import { timerHandler } from './timer';

export type TaskHandlerDeps = { platform: PlatformWrites; notifier: Notifier; dispatch: Dispatch };

/** Every task kind the dispatcher creates (chats/apply-commands.ts), and who runs it. */
export function createTaskHandlers(deps: TaskHandlerDeps): TaskHandlers {
  return {
    timer: timerHandler(deps.dispatch),
    summary: summaryHandler(deps),
    post_review: reviewHandler(deps),
    thread_replies: repliesHandler(deps),
    notify: notifyHandler(deps),
  };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm run test:db -w apps/server -- src/tasks && npm run typecheck -w apps/server && npm run lint`
Expected: PASS (handlers 10, plus the runner tests).

- [ ] **Step 6: Run every handler in the server**

In `apps/server/src/main.ts`:
- Add `import { createTaskHandlers } from './tasks/handlers/index';` and `import { LogNotifier } from './tasks/notifier';`, and remove the `timerHandler` import.
- Replace `new TaskRunner({ timer: timerHandler(dispatcher.dispatch) })` with:
```ts
  const notifier = new LogNotifier();
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier, dispatch: dispatcher.dispatch }));
```

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): task handlers for the summary, reviews, replies and notifications

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 28: Recovery on boot and the Plan 1a end-to-end test

**Files:**
- Create: `apps/server/src/ingest/recovery.ts`, `apps/server/src/ingest/recovery.db.test.ts`, `apps/server/src/platform/github/platform.test.ts`, `apps/server/test/integration/plan-1a.db.test.ts`
- Modify: `apps/server/src/platform/github/platform.ts` (add `redeliverFailed`), `apps/server/src/main.ts` (final version)

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `GithubPlatform.redeliverFailed(since)`;
  - `recoverOnBoot({ ingest, platform, now? }) → { tasks, replayed, redelivered }`;
  - the final `main.ts`, which Plan 1b extends with the CLI hub.

Spec §15 "Recovering after a restart":
- Replay `RawEvent` rows still marked `received`.
- Ask GitHub to redeliver deliveries that failed in the last 3 days (`GET /app/hook/deliveries`, `POST …/attempts`).
- Tasks left `running` go back to `pending` (Task 24).

The end-to-end test is the Plan 1a version of the spec §20 acceptance test. Plan 1b's CLI hub is the only missing piece, so the test plays the CLI's part by marking jobs running and reporting their results.

- [ ] **Step 1: Write the failing tests**

`apps/server/src/platform/github/platform.test.ts`:
```ts
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeFetch } from '../../../test/fake-fetch';
import { AppAuth } from './app-auth';
import { GithubClient } from './client';
import { GithubPlatform } from './platform';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const NOW = new Date('2026-10-07T18:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe('GithubPlatform.redeliverFailed', () => {
  it('asks GitHub to resend recent failed deliveries that never succeeded later', async () => {
    const fetch = fakeFetch({
      'GET /app/hook/deliveries': () => [
        { id: 1, guid: 'g-ok', status_code: 202, delivered_at: hoursAgo(1) },
        { id: 2, guid: 'g-retried', status_code: 502, delivered_at: hoursAgo(5) },
        { id: 3, guid: 'g-retried', status_code: 202, delivered_at: hoursAgo(4) },
        { id: 4, guid: 'g-lost', status_code: 0, delivered_at: hoursAgo(2) },
        { id: 5, guid: 'g-old', status_code: 500, delivered_at: hoursAgo(24 * 4) },
      ],
      'POST /app/hook/deliveries/4/attempts': () => ({}),
    });
    const github = new GithubClient(fetch);
    const platform = new GithubPlatform(github, new AppAuth(github, '12345', pem, () => NOW), async () => 'unused');

    expect(await platform.redeliverFailed(new Date(NOW.getTime() - 3 * 86_400_000))).toBe(1);
    expect(fetch.calls.filter((c) => c.method === 'POST').map((c) => c.url.pathname)).toEqual(['/app/hook/deliveries/4/attempts']);
  });
});
```

`apps/server/src/ingest/recovery.db.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb, uid } from '../../test/db';
import { prisma } from '../lib/prisma';
import { FakePlatform } from '../platform/fake/fake-platform';
import { createIngest } from './process';
import { recordDelivery } from './record';
import { recoverOnBoot } from './recovery';

beforeEach(resetDb);

describe('recoverOnBoot', () => {
  it('re-runs interrupted tasks, replays stored deliveries and asks GitHub for failed ones', async () => {
    await prisma.task.create({ data: { kind: 'notify', payload: {}, status: 'running', attempts: 1 } });
    await recordDelivery({ deliveryId: uid('d'), event: 'ping', action: null, repoId: null, body: '{}' });
    const handled: string[] = [];
    const ingest = createIngest(async (d) => { handled.push(d.event); return { status: 'ignored' }; });
    const platform = new FakePlatform();
    platform.redeliverFailed = async () => 2;

    expect(await recoverOnBoot({ ingest, platform })).toEqual({ tasks: 1, replayed: 1, redelivered: 2 });
    await ingest.idle();
    expect(handled).toEqual(['ping']);
  });

  it('still boots when GitHub cannot be reached', async () => {
    const platform = new FakePlatform();
    platform.redeliverFailed = async () => { throw new Error('offline'); };
    expect(await recoverOnBoot({ ingest: createIngest(async () => ({ status: 'ignored' })), platform })).toMatchObject({ redelivered: 0 });
  });
});
```

`apps/server/test/integration/plan-1a.db.test.ts`:
```ts
import type { JobResult } from '@nitpilot/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../../src/chats/dispatch';
import { createDeliveryHandler } from '../../src/ingest/handle';
import { createIngest } from '../../src/ingest/process';
import { prisma } from '../../src/lib/prisma';
import { FakePlatform } from '../../src/platform/fake/fake-platform';
import { createTaskHandlers } from '../../src/tasks/handlers/index';
import type { Notification } from '../../src/tasks/notifier';
import { TaskRunner } from '../../src/tasks/runner';
import { testApp } from '../app';
import { resetDb } from '../db';
import { installationEvent, issueCommentEvent, people, prEvent } from '../fixtures/github';
import { sendWebhook } from '../webhooks';

beforeEach(resetDb);

const ref = { installationId: '77', repoId: '501', repoFullName: 'octo/sandbox', number: 42 };
const point = (title: string, severity: 'major' | 'nit') => ({ path: 'src/orders/list.ts', line: 48, side: 'RIGHT' as const, severity, category: 'bug' as const, title, body: `${title}.`, snippet: null });

/** The server, wired exactly like main.ts, with GitHub replaced by FakePlatform. */
async function server() {
  const platform = new FakePlatform();
  const sent: Notification[] = [];
  const dispatcher = new Dispatcher();
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));
  // Run tasks as if a minute had passed, so debounced ones are due.
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier: { notify: async (n) => { sent.push(n); } }, dispatch: dispatcher.dispatch }), { now: () => new Date(Date.now() + 60_000) });
  const app = testApp({ ingest });
  const deliver = async (event: string, payload: unknown) => {
    expect((await sendWebhook(app, event, payload)).status).toBe(202);
    await ingest.idle();
  };
  const maya = await prisma.user.create({ data: { githubId: String(people.maya.id), login: 'maya' } });
  const leo = await prisma.user.create({ data: { githubId: String(people.leo.id), login: 'leo' } });
  await deliver('installation', installationEvent('created'));
  return { platform, sent, dispatcher, runner, deliver, maya, leo };
}

describe('Plan 1a end to end', () => {
  it('takes an agent-to-agent PR from opened to ready with one summary comment, telling only the reviewer', async () => {
    const s = await server();
    await s.deliver('pull_request', prEvent('opened'));
    const chatId = (await prisma.prChat.findFirstOrThrow()).id;

    // Plays the part of Plan 1b's CLI hub: hand the queued job to a CLI, then report its result.
    async function runJob(type: string, result: JobResult, pushTo?: string) {
      const job = await prisma.job.findFirstOrThrow({ where: { chatId, type, status: 'queued' } });
      await prisma.job.update({ where: { id: job.id }, data: { status: 'running', attempt: 1, expectedPushSha: pushTo ?? null } });
      if (pushTo) await s.deliver('pull_request', prEvent('synchronize', { before: 'a'.repeat(40), after: pushTo }));
      await s.dispatcher.dispatch(chatId, { type: 'job_completed', jobId: job.id, result });
      return job;
    }

    await runJob('review', { summary: 'Two issues.', points: [point('`parseOrder` crashes on empty input', 'major'), point('Rename `fetchAll`', 'nit')], decisions: [], replies: [], push: null });
    await runJob(
      'address',
      {
        summary: 'Fixed one, declined one.',
        points: [],
        decisions: [],
        replies: [
          { point: 1, resolution: 'fixed', comment: 'Added the empty check.' },
          { point: 2, resolution: 'declined', comment: 'Kept for API compatibility.' },
        ],
        push: { from: 'a'.repeat(40), to: 'c'.repeat(40) },
      },
      'c'.repeat(40),
    );
    expect(await prisma.job.findFirstOrThrow({ where: { chatId, type: 're_review' } })).toMatchObject({ sinceSha: 'a'.repeat(40), headSha: 'c'.repeat(40) });
    await runJob('re_review', { summary: 'All settled.', points: [], decisions: [{ point: 1, decision: 'resolve', comment: 'Fixed.' }, { point: 2, decision: 'resolve', comment: 'Fair.' }], replies: [], push: null });

    await s.runner.runDue();

    expect((await prisma.prChat.findUniqueOrThrow({ where: { id: chatId } })).phase).toBe('ready');
    const summaries = s.platform.writesFor(ref, 'summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.body).toContain('ready for approval');
    expect(summaries[0]!.body).toContain('fixed in ccccccc');
    // The agents talked in Nitpilot; the PR's review threads stay clean.
    expect(s.platform.writesFor(ref, 'review')).toEqual([]);
    expect(s.platform.writesFor(ref, 'reply')).toEqual([]);
    // Only the reviewer hears about it.
    expect(s.sent.map((n) => [n.kind, n.userIds])).toEqual([['ready', [s.leo.id]]]);
    expect(await prisma.rawEvent.count({ where: { status: { not: 'processed' } } })).toBe(0);
    expect(await prisma.job.count({ where: { chatId } })).toBe(3);

    // The summary comment's own webhook comes back and changes nothing (Review Focus #1).
    await s.deliver('issue_comment', issueCommentEvent('created', { id: 8800, user: people.bot, body: summaries[0]!.body }));
    expect(await prisma.point.count({ where: { chatId } })).toBe(2);
  });

  it("waits for a manual review on an outside contributor's PR and tells the reviewer", async () => {
    const s = await server();
    await s.deliver('pull_request', prEvent('opened', { pull: { author_association: 'FIRST_TIME_CONTRIBUTOR' } }));
    await s.runner.runDue();
    expect(await prisma.job.count()).toBe(0);
    expect(s.sent).toEqual([expect.objectContaining({ kind: 'manual_review', userIds: [s.leo.id] })]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test -w apps/server`
Expected: FAIL. `redeliverFailed` is not a function, and `./recovery` doesn't exist. The end-to-end file should already pass, because everything it uses exists. If it doesn't, fix that before going on.

- [ ] **Step 3: Add `redeliverFailed` to `GithubPlatform`**

In `apps/server/src/platform/github/platform.ts`, add this method to the class:
```ts
  /**
   * Ask GitHub to resend deliveries that failed since `since` and never succeeded on a later
   * attempt (spec §15). Looks at the most recent 100 deliveries.
   */
  async redeliverFailed(since: Date): Promise<number> {
    type Delivery = { id: number; guid: string; status_code: number; delivered_at: string };
    const token = this.appAuth.jwt();
    const { data } = await this.github.api<Delivery[]>('GET', '/app/hook/deliveries?per_page=100', { token });
    const ok = (d: Delivery) => d.status_code >= 200 && d.status_code < 300;
    const succeeded = new Set(data.filter(ok).map((d) => d.guid));
    let count = 0;
    for (const d of data) {
      if (ok(d) || succeeded.has(d.guid) || new Date(d.delivered_at) < since) continue;
      await this.github.api('POST', `/app/hook/deliveries/${d.id}/attempts`, { token });
      succeeded.add(d.guid); // one redelivery per delivery
      count += 1;
    }
    return count;
  }
```

- [ ] **Step 4: Write `recoverOnBoot`**

`apps/server/src/ingest/recovery.ts`:
```ts
import type { PlatformWrites } from '../platform/types';
import { recoverRunningTasks } from '../tasks/runner';
import type { Ingest } from './process';

const REDELIVER_WINDOW_MS = 3 * 86_400_000;

/** Pick up where a crashed or restarted server left off (spec §15 "Recovering after a restart"). */
export async function recoverOnBoot(deps: { ingest: Ingest; platform: PlatformWrites; now?: Date }): Promise<{ tasks: number; replayed: number; redelivered: number }> {
  const now = deps.now ?? new Date();
  const tasks = await recoverRunningTasks();
  const replayed = await deps.ingest.replayReceived();
  let redelivered = 0;
  try {
    redelivered = (await deps.platform.redeliverFailed?.(new Date(now.getTime() - REDELIVER_WINDOW_MS))) ?? 0;
  } catch (err) {
    console.warn('[recovery] could not ask GitHub for failed deliveries; continuing', err);
  }
  return { tasks, replayed, redelivered };
}
```

- [ ] **Step 5: Write the final `main.ts`**

Replace `apps/server/src/main.ts`:
```ts
import { serve } from '@hono/node-server';
import { getUserToken } from './auth/user-tokens';
import { Dispatcher } from './chats/dispatch';
import { createApp } from './http/app';
import { createDeliveryHandler } from './ingest/handle';
import { createIngest } from './ingest/process';
import { purgeOldRows } from './ingest/record';
import { recoverOnBoot } from './ingest/recovery';
import { acquireSingletonLock } from './lib/advisory-lock';
import { getEnv } from './lib/env';
import { AppAuth } from './platform/github/app-auth';
import { GithubClient } from './platform/github/client';
import { GithubPlatform } from './platform/github/platform';
import { createTaskHandlers } from './tasks/handlers/index';
import { LogNotifier } from './tasks/notifier';
import { TaskRunner } from './tasks/runner';

async function main(): Promise<void> {
  const env = getEnv();

  // One server per database (spec §7, docs/why/one-process.md).
  const lock = await acquireSingletonLock(env.DATABASE_URL);
  if (!lock) {
    console.error('Another Nitpilot server is already running against this database. Refusing to start.');
    process.exit(1);
  }

  // The outside world.
  const github = new GithubClient();
  const appAuth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const platform = new GithubPlatform(github, appAuth, (userId) => getUserToken(userId, github));
  const notifier = new LogNotifier();

  // The core loop: webhook → ingest → router → dispatcher (engine) → tasks → GitHub.
  const dispatcher = new Dispatcher();
  const runner = new TaskRunner(createTaskHandlers({ platform, notifier, dispatch: dispatcher.dispatch }));
  dispatcher.onCommit((_chatId, effects) => {
    if (effects.tasksCreated) runner.wake();
  });
  const ingest = createIngest(createDeliveryHandler({ platform, dispatch: dispatcher.dispatch }));

  const app = createApp({ github, appAuth, ingest });
  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`Nitpilot server listening on http://localhost:${info.port}`);
  });

  const recovered = await recoverOnBoot({ ingest, platform });
  console.log(`[boot] re-ran ${recovered.tasks} tasks, replayed ${recovered.replayed} deliveries, asked GitHub to resend ${recovered.redelivered}`);
  runner.start();
  const purge = setInterval(() => void purgeOldRows().catch((err) => console.error('[purge]', err)), 60 * 60_000);

  const shutdown = async () => {
    clearInterval(purge);
    runner.stop();
    server.close();
    await lock.release();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS in every workspace (redelivery 1, recovery 2, end to end 2 are new).

- [ ] **Step 7: Watch it on a real PR**

With `npm run dev -w apps/server` and `npm run dev:tunnel` running, and the app installed on a public sandbox repo (Task 23, Step 11):
1. As account B (signed in to Nitpilot), comment on the line of a PR that account A opened.
2. Wait 30 seconds (the debounce).

Expected: the server log shows the comment arriving and a timer task running. If A is signed in, an `address` job is queued for A. Jobs stay queued until Plan 1b's CLI exists. To see a GitHub write without a CLI, complete a job by hand from a `tsx` REPL with `dispatcher.dispatch(chatId, { type: 'job_completed', … })`. Then the summary comment appears on the PR within a few seconds, and editing it again leaves a single comment.

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): recovery on boot, final wiring and the Plan 1a end-to-end test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing this plan)

**Spec coverage.** Each spec section that Plan 1a touches, and where it's implemented:

| Spec | Where |
|---|---|
| §5 decisions (TypeScript, one process, Hono + Prisma 7, no Redis) | Tasks 1, 12, 13 |
| §6.1 modes, "answered where raised", trust | Tasks 8 (single-player reviewer), 9 (single-player author), 21 + 23 (trust), 27 (writes as user) |
| §6.2 happy path | Tasks 7–8, end-to-end test in Task 28 |
| §6.3 how a loop ends | Task 7 (`advance`), 8, 9 (approval) |
| §7 architecture, advisory lock, Task table | Tasks 13, 23, 24 |
| §8 data model | Task 12 (`PushSubscription` is Plan 2) |
| §9 engine, phases, point status, rounds, job lifecycle (engine side) | Tasks 6–11 |
| §10 protocol schemas, CLI login REST, `/api/me` | Tasks 3–5, 17 (`/ws/cli` is Plan 1b) |
| §12.1 platform adapter | Tasks 19, 21, 26, 28 (`findOpenPrsFor`/`listThreads` are Plan 1b) |
| §13 team rules | Tasks 3, 6, 23 |
| §14 server hardening, output cleaning, public-only | Tasks 14, 18, 22, 25 (agent and CLI controls are Plan 1b) |
| §15 GitHub specifics | Tasks 15–16, 18–23, 26–28 |
| §16 notifications | Task 27 (log only; CLI delivery in Plan 1b) |
| §17 local dev, dev tunnel | Tasks 2, 19 |
| §19 testing | Every task. The end-to-end test with the CLI is Plan 1b M10 |
| §21 docs/why | pure-engine, one-process, oauth-pkce, webhooks, outbox-and-restarts |

**Deferred on purpose:** the CLI hub, jobs reaching CLIs, the transcript page, catch-up searches (Plan 1b); drafts publishing, Web Push, Resolve/Continue (Plan 2); deploy (Plan 3).

**Consistency check.** These names are the same in every task that uses them:
- engine: `ChatState`, `DomainEvent`, `Command` (`type` discriminant; job type in `jobType`), `NewItem`;
- dispatch: `DispatchEffects`, `Dispatch`;
- platform: `PlatformReads`/`PlatformWrites`/`PlatformAdapter`, `PrRef`, `WriteOptions.reuseIfContains`;
- tasks: `TaskHandler`/`TaskHandlers`;
- id prefixes `issue:`/`review:`, and the dedupe keys `timer:<chatId>:<key>` / `summary:<chatId>`.

**Placeholder scan.** Every step has its code or its exact command. The temporary ingest handler in Task 18 is replaced in Task 23, and the timer-only runner in Task 24 is replaced in Task 27.
