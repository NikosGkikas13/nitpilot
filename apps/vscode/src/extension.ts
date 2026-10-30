import { loadConfig } from 'nitpilot/src/config/config';
import { ServerClient } from 'nitpilot/src/http';
import * as vscode from 'vscode';
import { poll, POLL_INTERVAL_MS, singleFlight, type Poll } from './poll';
import { nextLastGood, retryMessage, statusBar, tree, type ChatRow, type Group, type LastGood, type TreeModel } from './view-model';

/** One row of the sidebar: the "sign in again" row, a group, or a PR. */
type Node = { kind: 'reauth' } | { kind: 'group'; group: Group } | { kind: 'chat'; row: ChatRow };

/**
 * VS Code calls this once, after startup (`onStartupFinished`). Everything it creates goes in
 * `context.subscriptions`, which VS Code disposes when the extension stops. See docs/why/vscode-extensions.md.
 */
export function activate(context: vscode.ExtensionContext): void {
  let current: Poll | null = null;
  let lastGood: LastGood | null = null;
  let model: TreeModel = { reauthRow: false, groups: [], message: undefined };

  const output = vscode.window.createOutputChannel('Nitpilot');
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
  item.text = '$(sync~spin) Nitpilot';
  item.show();

  // The tree asks for children; firing `changed` makes it ask again (like setState causing a re-render).
  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.TreeDataProvider<Node> = {
    onDidChangeTreeData: changed.event,
    getChildren: (node) => {
      if (!node) return [...(model.reauthRow ? [{ kind: 'reauth' } as const] : []), ...model.groups.map((group) => ({ kind: 'group', group }) as const)];
      return node.kind === 'group' ? node.group.rows.map((row) => ({ kind: 'chat', row }) as const) : [];
    },
    getTreeItem: treeItem,
  };
  const view = vscode.window.createTreeView('nitpilot.prs', { treeDataProvider: provider });

  const refresh = singleFlight(async () => {
    const result = await poll();
    if (result.state !== current?.state) output.appendLine(`${new Date().toISOString()} ${result.state}${'message' in result ? `: ${result.message}` : ''}`);
    current = result;
    lastGood = nextLastGood(result, lastGood, new Date());
    model = tree(result, lastGood);
    view.message = model.message;
    const empty = result.state === 'ok' && result.chats.length === 0;
    await vscode.commands.executeCommand('setContext', 'nitpilot.state', empty ? 'empty' : result.state);
    changed.fire();
    const bar = statusBar(result);
    item.text = bar.text;
    item.tooltip = bar.tooltip;
    item.command = bar.command;
    item.backgroundColor = bar.warning ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  });

  const open = (url: string) => vscode.env.openExternal(vscode.Uri.parse(url));

  context.subscriptions.push(
    output,
    item,
    changed,
    view,
    vscode.commands.registerCommand('nitpilot.refresh', () => refresh()),
    vscode.commands.registerCommand('nitpilot.showPrs', () => vscode.commands.executeCommand('workbench.view.extension.nitpilot')),
    vscode.commands.registerCommand('nitpilot.openServer', () => {
      const server = current?.server ?? serverFromConfig();
      if (server) void open(server);
    }),
    vscode.commands.registerCommand('nitpilot.openChat', (node: Node) => node.kind === 'chat' && open(node.row.chat.url)),
    vscode.commands.registerCommand('nitpilot.openGithub', (node: Node) => node.kind === 'chat' && open(node.row.githubUrl)),
    vscode.commands.registerCommand('nitpilot.login', () => {
      const terminal = vscode.window.terminals.find((t) => t.name === 'Nitpilot') ?? vscode.window.createTerminal('Nitpilot');
      terminal.show();
      terminal.sendText('nitpilot login');
    }),
    vscode.commands.registerCommand('nitpilot.retry', async (node: Node) => {
      if (node.kind !== 'chat') return;
      const { chat } = node.row;
      item.text = '$(sync~spin) Retrying…';
      try {
        const cfg = loadConfig();
        const { status } = await new ServerClient(cfg.server, cfg.token).retry(chat.id);
        vscode.window.setStatusBarMessage(retryMessage(chat, status), 5000);
      } catch (err) {
        void vscode.window.showErrorMessage((err as Error).message);
      }
      await refresh();
    }),
    // Poll only while this window is focused, so ten open windows aren't ten clients; catch up the moment it is.
    vscode.window.onDidChangeWindowState((state) => state.focused && refresh()),
    disposableInterval(() => vscode.window.state.focused && refresh(), POLL_INTERVAL_MS),
  );

  void refresh();
}

export function deactivate(): void {}

function treeItem(node: Node): vscode.TreeItem {
  if (node.kind === 'reauth') {
    const t = new vscode.TreeItem('GitHub sign-in expired. Sign in again');
    t.iconPath = new vscode.ThemeIcon('warning');
    t.command = { command: 'nitpilot.openServer', title: 'Sign in again' };
    return t;
  }
  if (node.kind === 'group') {
    const t = new vscode.TreeItem(node.group.label, vscode.TreeItemCollapsibleState.Expanded);
    t.id = node.group.id; // keeps a group's expanded state across refreshes
    return t;
  }
  const { row } = node;
  const t = new vscode.TreeItem(row.label);
  t.description = row.description;
  t.tooltip = row.tooltip;
  t.iconPath = new vscode.ThemeIcon(row.icon);
  t.contextValue = row.contextValue;
  t.command = { command: 'nitpilot.openChat', title: 'Open chat on Nitpilot', arguments: [node] };
  return t;
}

/** The server from config.json, or null when it can't be read (the welcome view already shows why). */
function serverFromConfig(): string | null {
  try {
    return loadConfig().server;
  } catch {
    return null;
  }
}

function disposableInterval(fn: () => unknown, ms: number): vscode.Disposable {
  const timer = setInterval(fn, ms);
  return { dispose: () => clearInterval(timer) };
}
