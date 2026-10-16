/**
 * A Map whose entries expire, and which never holds more than `maxEntries`: past that, the oldest entry goes.
 * For answers worth keeping a few minutes (who can read a repo, a PR's changed files), when the keys come from
 * requests and so must not grow without bound.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The value, if it was set less than `ttlMs` ago. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    return entry && this.now() - entry.at < this.ttlMs ? entry.value : undefined;
  }

  /** A Map remembers the order keys were added in: deleting first moves a repeated key to the end, so the first key is always the oldest. */
  set(key: string, value: V): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, at: this.now() });
  }
}
