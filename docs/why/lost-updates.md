# Lost updates: write back only what you changed

**In one sentence:** when the dispatcher saves a chat, it writes only the fields the engine changed, so a field that another part of the server saved in the meantime is never put back to the old value.

## The problem

Saving a chat is "read, decide, write": the dispatcher loads the chat, the engine works out the new state, and the dispatcher writes it back (`chats/dispatch.ts`, [dispatcher.md](dispatcher.md)). The chat's lock makes sure two events for one chat never do that at the same time.

But not every write goes through the dispatcher. When a reviewer's agent posts its points to GitHub, the review task (`tasks/handlers/review.ts`) saves each point's GitHub comment id straight into the `Point` row, without the chat's lock, because GitHub calls never happen under it. So this can happen:

1. The dispatcher loads P1: no comment id yet.
2. The review task posts P1 to GitHub and saves its comment id.
3. The engine, working on the copy from step 1, marks P1 resolved.
4. The dispatcher writes P1 back: status `resolved`, and comment id `null`, the value it loaded.

Step 4 throws away step 2's write. That's a **lost update**: nobody did anything wrong, but a value someone saved disappears. Here it would cut P1 off from its GitHub thread, so a reply there would no longer find its point.

## The fix

`saveChatState` (`chats/save.ts`) compares each point and participant as loaded with what the engine returned, and writes only the fields that differ (`changedFields`). In step 4 only `status` changed, so only `status` is written, and the comment id from step 2 stays. `chats/save.db.test.ts` plays the four steps above.

It works because the engine never touches the comment id on a point it didn't just create: if it did change a field, its value is the newer one and should win.

## The React analogy

It's the difference between `setUser(loadedUser)` and `setUser((u) => ({ ...u, name }))`. The first overwrites everything with the copy you had when you started; the second changes only the field you meant to change and keeps whatever else happened meanwhile.
