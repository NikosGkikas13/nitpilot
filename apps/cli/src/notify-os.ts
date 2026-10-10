import { execFile } from 'node:child_process';
import { BRAND } from '@nitpilot/protocol';

type Exec = (file: string, args: string[]) => Promise<void>;

/**
 * Show a desktop notification (spec §16, Plan 1). macOS uses osascript, Linux notify-send; elsewhere
 * the line in the terminal is all. The text goes in as an argument, never pasted into a script, so a PR
 * title with quotes in it can't turn into AppleScript.
 */
export async function notifyOs(message: string, deps: { platform?: NodeJS.Platform; exec?: Exec } = {}): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const exec = deps.exec ?? execQuietly;
  if (platform === 'darwin') {
    await exec('osascript', ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', BRAND.name, message]);
  } else if (platform === 'linux') {
    await exec('notify-send', [BRAND.name, message]);
  }
}

/** Run a program and ignore how it went: a missing notify-send must never stop the daemon. */
function execQuietly(file: string, args: string[]): Promise<void> {
  return new Promise((resolve) => execFile(file, args, () => resolve()));
}
