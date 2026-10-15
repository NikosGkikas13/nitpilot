# The database: schema, migrations and constraints

**In one sentence:** `apps/server/prisma/schema.prisma` describes every table, Prisma turns changes to that file into SQL "migrations" that update the real database step by step, and a few rules (unique columns, cascading deletes) are enforced by Postgres itself.

## The React analogy

- **The schema is like a TypeScript type for your whole app state**, except the state lives in Postgres and survives restarts. `model PrChat { ... }` is one table; each line is a column.
- **Prisma Client is a generated, fully typed API for that state.** After `prisma generate`, `prisma.prChat.findMany(...)` autocompletes the fields, a bit like a typed `fetch` wrapper produced from an OpenAPI spec. The generated code lives in `apps/server/src/generated/prisma/` (git-ignored, rebuilt by `npm install`).
- **A migration is like a commit for the database's shape.** You can't just swap a type on a live database full of data. Each schema change becomes a numbered SQL file in `prisma/migrations/`, applied in order, once. Every developer, CI and production replay the same files, so they all end up with the same tables.

## Day-to-day commands (run from the repo root)

| You want to | Run |
|---|---|
| Change a table | Edit `schema.prisma`, then `npm run db:migrate -w apps/server -- --name what_changed`, then `npm run db:generate -w apps/server` (Prisma 7 no longer generates the client during `migrate dev`) |
| Apply migrations somewhere (CI, production) | `npm run db:deploy -w apps/server` |
| Rebuild the typed client | `npm run db:generate -w apps/server` (also runs on every `npm install`) |

## Rules the database enforces for us

Some rules are too important to leave to "remember to check in code". Postgres refuses the write instead:

- **Unique columns.** `Job.activeFor` holds the participant's id while their job is queued or running, and `null` afterwards. Because the column is `@unique`, Postgres rejects a second active job for the same person (spec §9.4), even if two requests race. `isUniqueViolation(err)` in `src/lib/prisma.ts` recognizes that rejection.
- **Cascading deletes.** `onDelete: Cascade` means deleting a GitHub installation also deletes its repos, their chats, and everything inside those chats. No orphaned rows.

`src/lib/prisma.db.test.ts` checks both against the real database.

## Two requests at once: why not `upsert`

"Create it, or update it if it exists" sounds like one step, and Prisma has `upsert` for it. But `upsert` can be two steps underneath: it looks for the row, and if it finds nothing, it inserts one. Think of two `setState` calls that both read the old state before either writes. Two requests (two browser tabs marking the same chat read) can both look, both find nothing, and both insert. The unique rule (`@@unique([userId, chatId])`) lets one through and refuses the other, and that request fails with a 500.

`apps/server/src/http/routes/inbox.ts` does it in three plain steps instead: **create** the row; if Postgres says it already exists (`isUniqueViolation`), carry on, since someone else just made it; then move the cursor forward with `updateMany ... where lastReadSeq < seq`, which changes nothing if the cursor is already at or past that point. Each step is safe to run twice, and the cursor never moves back. The test "stores one cursor per person and chat" fires three requests at once to keep it honest.

## Tests that use the database

Files named `*.db.test.ts` run against the local Postgres from `docker-compose.yml`, one file at a time. Every row they create uses unique values (`uid()`, `ghId()` in `apps/server/test/db.ts`), so tests don't trip over each other's data. Run them with `npm run test:db -w apps/server`; run the fast, database-free tests with `npm run test:unit -w apps/server`.

**Tests have their own database.** One Postgres server can hold several separate databases, the way one browser holds a separate `localStorage` per site. The dev server uses `nitpilot`; tests use `nitpilot_test` on the same server. That matters because some tests empty every table first (`resetDb()`), and before this split each test run wiped your dev sign-ins, installations and chats.

- `apps/server/test/test-database.ts` turns your `DATABASE_URL` into the test one by adding `_test` to the database name.
- `apps/server/vitest.config.ts` swaps that url into the tests' environment, so `prisma` inside a test only ever sees `nitpilot_test`.
- `apps/server/test/global-setup.ts` runs once before the database tests: it creates `nitpilot_test` if it's missing and applies every migration to it. You never create or migrate it by hand.

`test/helpers.db.test.ts` checks that the tests really are connected to a `*_test` database.
