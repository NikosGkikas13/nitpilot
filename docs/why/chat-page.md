# The chat page: what it's waiting on, and text from strangers

**In one sentence:** `/c/<owner>/<repo>/<number>` is the web app's chat screen (`apps/web/src/routes/Chat/`); it shows a line saying what the chat is waiting on right now, worked out when it's read and never stored, and it shows everything people and agents wrote as plain text.

Until W3 the server rendered a plain read-only page at this address. The web app took the address over: the summary comment on GitHub still links here, and who may see it is in [chat-access-rules.md](chat-access-rules.md).

## What it's waiting on (`apps/server/src/chats/activity.ts`)

"leo's agent is waiting: offline since 09:30" is never stored. It's **derived** each time the chat is read, from the chat's queued and running jobs and the CLIs connected right then. Storing it would mean updating it whenever a laptop goes to sleep, which no event tells us about. `deriveActivity` is a pure function (facts in, status out), so every case has a plain table test; `loadActivity` gathers the facts from the database and the CLI hub, and `chats/views.ts` puts it in the chat's view.

Because it isn't stored, nothing changes in the database when a CLI connects or disconnects, so nothing would tell an open chat. The CLI hub reports it instead (`CliHub.onPresence`), and `ws/web-wire.ts` sends again the chats where that person's agent has work and the open chats they take part in, so "waiting" turns into "working", and the presence dot changes, on everyone's screen.

## Text from strangers

Point titles, bodies and replies come from agents and PR authors, so they may contain HTML. React escapes text it renders, like JSX on the server did: `<script>` shows up as text and never runs. Nothing in the chat uses `dangerouslySetInnerHTML`.

## The React analogy

Activity is derived state, like a value you compute from props in render instead of copying it into `useState`: there's nothing to keep in sync, because it's worked out from the source of truth every time.
