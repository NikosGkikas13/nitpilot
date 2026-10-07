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

## Tests that use the database

Files named `*.db.test.ts` run against the local Postgres from `docker-compose.yml`, one file at a time. Every row they create uses unique values (`uid()`, `ghId()` in `apps/server/test/db.ts`), so tests don't trip over each other's data. Run them with `npm run test:db -w apps/server`; run the fast, database-free tests with `npm run test:unit -w apps/server`.
