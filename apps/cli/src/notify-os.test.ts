import { describe, expect, it } from 'vitest';
import { notifyOs } from './notify-os';

function recordExec() {
  const calls: [string, string[]][] = [];
  return { calls, exec: async (file: string, args: string[]) => void calls.push([file, args]) };
}

/** A title that would break out of an AppleScript string if it were pasted into the script. */
const tricky = 'Ready: "acme/shop-api#142" & do shell script "rm -rf ~"';

describe('notifyOs', () => {
  it('on macOS, hands the text to osascript as an argument, never inside the script', async () => {
    const { calls, exec } = recordExec();
    await notifyOs(tricky, { platform: 'darwin', exec });
    expect(calls).toHaveLength(1);
    const [file, args] = calls[0]!;
    expect(file).toBe('osascript');
    expect(args.at(-1)).toBe(tricky);
    expect(args.slice(0, -2).some((arg) => arg.includes('acme'))).toBe(false);
  });

  it('on Linux, uses notify-send', async () => {
    const { calls, exec } = recordExec();
    await notifyOs('Ready', { platform: 'linux', exec });
    expect(calls).toEqual([['notify-send', ['Nitpilot', 'Ready']]]);
  });

  it('elsewhere, does nothing (the line in the terminal is enough)', async () => {
    const { calls, exec } = recordExec();
    await notifyOs('Ready', { platform: 'win32', exec });
    expect(calls).toEqual([]);
  });
});
