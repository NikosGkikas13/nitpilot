# The browser's WebSocket: cookies, Origin, and resuming without gaps

**In one sentence:** each browser tab opens one WebSocket to `/ws/web`, signed in by the same cookie as every REST call, and the server pushes new chat items down it the moment they're saved, so a chat updates while the agents work without anyone reloading.

## Two hubs, one server (`ws/upgrade-router.ts`)

Node gives an HTTP server a single `'upgrade'` event for every WebSocket request, whatever its path. With two hubs (`/ws/cli` for CLIs, `/ws/web` for browsers) both listening, both would answer the same request. So one small router listens, reads the path, and hands the request to that path's hub; any other path gets a 404. It's a `<Routes>` for sockets.

## Who may open one (`ws/web-hub.ts`)

A CLI proves who it is with a `Bearer` token it sends on purpose. A browser sends the session cookie on its own, to any request for our address, including a WebSocket that another site's page opens. That's the catch:

- **SameSite doesn't help.** `SameSite=Lax` keeps the cookie off cross-site POSTs, but browsers send it on a cross-site WebSocket anyway. A page on `evil.example` could open `wss://nitpilot.dev/ws/web` and receive your chats as you. That attack is called cross-site WebSocket hijacking.
- **The Origin header does.** Every WebSocket request carries `Origin`: the site whose page opened it. The browser sets it, and a page can't change it. The hub checks it before upgrading (`isAllowedUpgradeOrigin` in `lib/csrf.ts`): our own address, or `PUBLIC_URL`, or no socket (403). No `Origin` at all is a no too: browsers always send one.
- **Then the cookie.** No valid session: 401, and no socket.

Both checks happen before the upgrade, while it's still an ordinary HTTP request that can be refused with a status code.

In React terms: the REST writes already do this check (`requireSameOrigin`), because a form on another site could post to us with your cookie. A WebSocket is the same risk in a different shape.

## Who may follow which chat

Opening the socket only proves who you are. Each chat a tab wants is a `chat.subscribe`, and the hub asks the same question as the REST routes: can your GitHub account read this repo (`chats/access.ts`, `auth/repo-access.ts`, spec §16)? If not, the tab gets `chat.error not_found`, the same answer as for a chat that doesn't exist, and nothing of that chat is ever sent.

The answer is kept 5 minutes. A socket can stay open for hours, so when an answer is older than that, the next thing about to be sent for that chat asks GitHub again. Someone removed from the repo stops getting items within those 5 minutes, and gets `chat.error`. If GitHub doesn't answer when the hub asks again, the chat is dropped the same way, with `chat.error unavailable`: the tab asks again a few seconds later and resumes from its newest `seq`, so nothing is lost. Signing out closes that session's sockets right away with `4401` (`WebHub.closeSession`, called by the logout route), and the tab shows the landing page; a session that merely expired is noticed the next time something is sent for it. The same person's other sessions stay open.

## Resuming without gaps

A tab that reconnects (the laptop slept, the Wi-Fi dropped) must show every item exactly once, in order. Every item has a `seq`: 1, 2, 3… per chat, with no gaps (spec §8). The tab subscribes with the newest `seq` it has (`afterSeq`). The hard part is the moment between "read what you missed from the database" and "start sending live items": an item saved right then could fall between the two, or arrive twice.

So the hub does it in this order:

```
1. register the subscription, with an empty buffer   ← from now on, live items wait in the buffer
2. read every item after afterSeq from the database  ← an item saved during this read is in the DB…
3. send them                                         ← …and goes out here
4. send the buffer, skipping any seq already sent    ← …so its copy in the buffer is skipped
5. from now on, send live items straight away
```

An item saved before step 1 is in the database: step 2 reads it. An item saved after step 1 lands in the buffer: step 4 sends it, unless step 2 already did. Nothing falls in between, and nothing goes twice. The test "sends an item saved while the catch-up is being read exactly once" in `ws/web-hub.db.test.ts` saves an item in the middle of step 2.

The browser keeps a second guard: it drops any `seq` it already has, and after a reconnect it subscribes again with each open chat's newest `seq`.

## Keeping it honest

- Everything for one socket happens in order (`lib/serial-queue.ts`), so a catch-up and the live items after it can't overtake each other.
- A browser only ever sends `chat.subscribe` and `chat.unsubscribe`. Anything else, or anything over 64 KB, closes the socket (1008, or 1009 for the size).
- A ping every 30 s; a socket that didn't answer the last one is closed, so a dead tab is gone within a minute.

## The React analogy

- `chat.subscribe` is a `useEffect` that subscribes to a store and returns an unsubscribe, with the `seq` as a cursor, like a paginated query's `getNextPageParam`.
- The buffer is what you'd do if a subscription could fire while your initial `fetch` was still loading: hold the updates, then apply them on top of the fetched data, ignoring those the fetch already included.
