# VS Code extensions: a small React app inside the editor

**In one sentence:** the Nitpilot extension (`apps/vscode`) is a little program VS Code loads after it starts. It asks the server for your PRs every 30 seconds while the window is focused, then draws a status bar item and a sidebar from the answer.

## The pieces, in React terms

- **`contributes` in `package.json` is a static manifest**, like a route table. It tells VS Code, before any of our code runs, which sidebar icon, view, commands, right-click menu entries and empty-state texts exist. VS Code draws the icon and menus from it on its own.
- **`activate()` in `src/extension.ts` is `main.tsx`.** VS Code calls it once (`"activationEvents": ["onStartupFinished"]`, so it never slows the editor's startup). It creates the status bar item and the tree view and registers the commands. Everything it creates goes in `context.subscriptions`, which VS Code cleans up when the extension stops, like the cleanup function a `useEffect` returns.
- **A TreeDataProvider is a component.** `getChildren(node)` is its render: given a row (or nothing, for the top level), return the rows under it. `getTreeItem` turns one row into what's drawn (label, icon, tooltip, click command). Firing `onDidChangeTreeData` is `setState`: VS Code calls `getChildren` again.
- **Context keys and `when` clauses are conditional rendering from global state.** The extension sets `nitpilot.state` (for example `logged_out` or `empty`) with `setContext`. In `package.json`, each empty-state text (`viewsWelcome`) has a `when: "nitpilot.state == logged_out"`, so VS Code shows the right one with no code of ours. The right-click menu works the same way: **Retry agent** has `when: "viewItem == chat.failed"`, and only failed rows get that `contextValue`.
- **The logic is outside VS Code.** `src/poll.ts` (ask the server) and `src/view-model.ts` (turn the answer into texts and groups) don't import `vscode`, so plain Vitest tests cover them. `extension.ts` only wires their output into VS Code, like keeping logic in hooks and components thin.

## Where the login comes from

The extension has no sign-in of its own. It reads the CLI's `config.json` with the CLI's own `loadConfig` and calls the server with the CLI's own `ServerClient` (`apps/cli/src/config/config.ts`, `apps/cli/src/http.ts`). Both are bundled into `dist/extension.cjs` at build time, so there's one copy of that code for the CLI and the extension. It reads the config again on every poll, so after `nitpilot login` the next poll is logged in.

Why not run `nitpilot status --json` instead: VS Code opened from the Dock often can't see the shell's PATH, so "command not found" would be the most common bug; and it would need CLI 0.3.0 or later.

## Why polling here, when the CLI uses a WebSocket

[WebSockets](websockets.md) explains why the CLI keeps a socket open: a job must reach the agent within seconds. The extension only shows a counter, and 30 seconds late is fine. The server's two sockets don't fit it anyway: `/ws/cli` belongs to `nitpilot start` (a second connection from the same device would take over its jobs), and `/ws/web` signs in with the browser's cookie and follows one chat at a time.

So the extension polls, and keeps it cheap:

- only while its window is focused (ten open windows aren't ten clients), plus once the moment a window gets focus;
- never two polls at once (`singleFlight` in `poll.ts`: a second trigger gets the poll already running, like deduplicated requests in React Query);
- each request gives up after 10 seconds.

If the server can't be reached, the last list stays in the sidebar with "as of 14:02", like showing cached data while a refetch fails.
