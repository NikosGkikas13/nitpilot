import { BRAND } from '@nitpilot/protocol';

// Turning a real GitHub delivery (a RawEvent row) into a fixture file that is safe to commit.
// Used by scripts/record-fixtures.ts and checked again by recorded.test.ts.

/** What a recorded file holds. `payload` is the delivery's body as GitHub sent it, minus the noise `scrubPayload` removes. */
export type RecordedFixture = { event: string; action: string | null; note: string; recordedAt: string; payload: unknown };

/** The parts of a stored delivery that a fixture needs. */
export type DeliveryRow = { event: string; action: string | null; body: string; createdAt: Date };

// GitHub fills its payloads with links and ids that Nitpilot never reads. Dropping them keeps each file a few
// kilobytes instead of tens, and keeps the diff readable. `html_url` stays: the PR's own address is read.
const DROP_KEYS = new Set(['node_id', 'gravatar_id', '_links', 'url']);
const KEEP_LINKS = new Set(['html_url']);

function isNoise(key: string): boolean {
  return DROP_KEYS.has(key) || (key.endsWith('_url') && !KEEP_LINKS.has(key));
}

/** A copy of a payload without links and node ids, at any depth. Everything else is kept exactly as GitHub sent it. */
export function scrubPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubPayload);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!isNoise(key)) out[key] = scrubPayload(inner);
  }
  return out;
}

// Webhook bodies don't carry credentials (the signature is a header, which RawEvent doesn't store), but a PR
// description or comment is whatever a person typed. This is the last check before a file is written or committed.
const SECRET_SHAPES: [string, RegExp][] = [
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['a fine-grained GitHub token', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['a Nitpilot token', new RegExp(`\\b${BRAND.tokenPrefix}[A-Za-z0-9_-]{16,}`)],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a signed JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a bearer token', /\bBearer\s+[A-Za-z0-9._-]{20,}/],
  ['a webhook signature', /\bsha256=[0-9a-f]{64}/],
];

/**
 * Which kinds of secret `text` seems to hold, by name (never the secret itself). `exact` adds strings that
 * must not appear at all, such as this server's own webhook secret.
 */
export function findSecrets(text: string, exact: string[] = []): string[] {
  const found = SECRET_SHAPES.filter(([, shape]) => shape.test(text)).map(([name]) => name);
  if (exact.some((secret) => secret !== '' && text.includes(secret))) found.push('a secret you asked about');
  return found;
}

/** One stored delivery as a fixture. Throws, naming the kind of secret, if the payload seems to hold one. */
export function buildFixture(row: DeliveryRow, note: string, exact: string[] = []): RecordedFixture {
  const payload = scrubPayload(JSON.parse(row.body));
  const secrets = findSecrets(JSON.stringify(payload), exact);
  if (secrets.length > 0) throw new Error(`This delivery seems to contain ${secrets.join(' and ')}. Nothing was written.`);
  return { event: row.event, action: row.action, note, recordedAt: row.createdAt.toISOString().slice(0, 10), payload };
}

/** `<name>.json`, for a name like `pull_request.review_requested`. Only lowercase letters, digits, dots, dashes and underscores. */
export function fixtureFileName(name: string): string {
  if (!/^[a-z0-9_][a-z0-9_.-]*$/.test(name)) throw new Error(`Fixture name ${JSON.stringify(name)} must be lowercase letters, digits, dots, dashes or underscores, like pull_request.opened.`);
  return `${name}.json`;
}

/** What `record-fixtures list` shows next to each delivery: which PR it was about, who caused it, and a few words that tell it from its twins. */
export function deliveryFacts(payload: unknown): { pr: number | null; sender: string | null; detail: string } {
  const p = payload as {
    pull_request?: { number?: number };
    issue?: { number?: number };
    sender?: { login?: string };
    requested_reviewer?: { login?: string };
    changes?: Record<string, unknown>;
    comment?: { body?: string; in_reply_to_id?: number };
    review?: { state?: string };
    after?: string;
  };
  return { pr: p.pull_request?.number ?? p.issue?.number ?? null, sender: p.sender?.login ?? null, detail: detailOf(p) };
}

function detailOf(p: { requested_reviewer?: { login?: string }; changes?: Record<string, unknown>; comment?: { body?: string; in_reply_to_id?: number }; review?: { state?: string }; after?: string }): string {
  if (p.requested_reviewer?.login) return `reviewer ${p.requested_reviewer.login}`;
  if (p.changes) return `changed: ${Object.keys(p.changes).join(', ')}`;
  if (p.comment?.body !== undefined) {
    const text = p.comment.body.length > 30 ? `${p.comment.body.slice(0, 30)}…` : p.comment.body;
    return `${p.comment.in_reply_to_id ? 'reply' : 'comment'} "${text}"`;
  }
  if (p.review?.state) return `review ${p.review.state}`;
  if (p.after) return `head ${p.after.slice(0, 7)}`;
  return '';
}
