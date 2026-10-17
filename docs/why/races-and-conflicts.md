# Two clicks at once: exactly one effect, and a 409 for the other

**In one sentence:** when two requests try to change the same thing at the same moment (Resolve pressed twice, two people pressing Continue), the chat's lock lets them through one at a time, the first one changes the chat, and the second finds there's nothing left to do and is answered `409 Conflict` with a sentence that says why.

## The problem

A double click sends two requests. So do two people looking at the same chat. Both requests are checked ("may leo resolve P1?" yes, twice) before either has changed anything. If both then went on and did their thing, P1 would be resolved twice: two "leo resolved P1" lines, two "Ready" notifications.

## How Nitpilot handles it

Every chat write becomes one engine event (`point_resolve`, `point_continue`, …) that goes through the dispatcher, and the dispatcher runs one event per chat at a time under the chat's lock (`chats/dispatch.ts`, [dispatcher.md](dispatcher.md)). Inside the lock, the engine looks at the chat **as it is now**:

1. The first Resolve finds P1 escalated: it resolves it, writes the line, and the chat may become ready.
2. The second Resolve finds P1 already resolved. The engine changes nothing: no line, no command (`engine/human.ts`).

The route sees that the event changed nothing (no timeline item) and answers `409 conflict` with what happened: "P1 is already resolved." or "P1 isn't escalated any more: the agents have it." (`http/routes/chat-actions.ts`). The web app shows that sentence as a toast. Nothing on screen changes from the click itself: the real change arrives on `/ws/web` like any other.

Retry works the same way: the second of two Retry presses finds nothing failed any more, and gets "Your agent is already on it."

## Why 409 and not 403

`403 Forbidden` means "you may never do this here" (you didn't raise P1, so you can't resolve it). `409 Conflict` means "you could have, but the chat moved on". The role check (`chats/permissions.ts`) deliberately doesn't look at a point's status, so a late click is always a 409 with an explanation, never a confusing "you're not allowed".

## Where it's tested

`chat-actions.db.test.ts` sends two Resolves, two Continues and two Retries with `Promise.all`, and checks that exactly one is a 200, the other a 409, and that the chat changed once.

## The React analogy

It's like guarding a submit handler with `if (isSubmitting) return;`, except the guard lives on the server, so it also works for two browsers, and the second click is told what happened instead of being ignored silently.
