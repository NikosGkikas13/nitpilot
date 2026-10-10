import type { Out } from '../src/out';

/** An Out that remembers everything printed, for assertions. */
export function recordOut(): Out & { lines: string[]; text(): string } {
  const lines: string[] = [];
  return {
    lines,
    log: (text) => void lines.push(text),
    error: (text) => void lines.push(text),
    text: () => lines.join('\n'),
  };
}
