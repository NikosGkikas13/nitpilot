# N+1 queries: why the inbox reads all its chats at once

**In one sentence:** the inbox needs facts about many chats, and asking the database once per chat would make the page slower with every PR a person is part of, so the server asks once for all of them (`loadActivities` in `apps/server/src/chats/activity.ts`, and the inbox rows in `apps/server/src/chats/inbox.ts`).

## The problem

The obvious way to build a list is a loop: read the list (1 query), then for each item read its details (N more queries). That's "N+1". With 3 chats it's 4 queries and nobody notices. With 200 chats it's 201 round trips to Postgres, one after another, every time someone opens the inbox.

Each query costs a round trip (the request goes to Postgres and the answer comes back), even when Postgres finds the rows instantly. Round trips add up; rows mostly don't.

## The fix

Ask for everything at once and sort it out in memory:

```ts
// N+1: one query per chat
for (const id of chatIds) activities.set(id, await loadActivity(id, clis));

// Constant: one query for all the chats, then plain JavaScript
const chats = await prisma.prChat.findMany({ where: { id: { in: chatIds } }, include: { jobs: true, … } });
for (const chat of chats) activities.set(chat.id, deriveActivity(…));
```

Prisma's `include` still sends a few queries (one per relation: the chats, then their jobs, then their participants…), but that number is fixed. Reading 1 chat or 200 chats takes the same handful of queries.

## How the tests check it

`test/queries.ts` has `countQueries(run)`: it counts the SQL queries Prisma sends while `run` runs (Prisma emits a `query` event for each one; `apps/server/src/lib/prisma.ts` turns the events on). A test reads 1 chat, then 3 (or 30), and expects the same count. It doesn't pin the exact number, which would break whenever Prisma changes how it splits an `include`; it pins the property that matters: the count doesn't grow with the list.

## The React analogy

It's the difference between each `<InboxRow>` calling `useQuery(['chat', id])` on mount, which sends one request per row (a waterfall the Network tab makes obvious), and the `<Inbox>` calling `useQuery(['inbox'])` once and handing each row its data as props. Same screen, one request instead of a hundred.
