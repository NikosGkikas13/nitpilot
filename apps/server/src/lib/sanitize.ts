import { BRAND } from '@nitpilot/protocol';

const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  new RegExp(`\\b${BRAND.tokenPrefix}[A-Za-z0-9_-]{43}`, 'g'),
];

// An @mention not preceded by a word character, backtick, slash, @ or dot (so emails are safe).
const MENTION = /(^|[^\w`/@.])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9_.-]+)?)/g;

// Fenced code blocks and inline code. GitHub never turns @names inside them into mentions.
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/;

export type SanitizeOptions = {
  /** Logins of the people in the PR; everyone else's mention is neutralized. */
  allowedMentions: string[];
  maxLength: number;
};

/** Make agent-written text safe to post on GitHub (spec §14.6). */
export function sanitizeForGithub(text: string, opts: SanitizeOptions): string {
  let out = text;
  for (const pattern of SECRETS) out = out.replace(pattern, '[redacted]');
  out = stripMarkup(out);

  const allowed = new Set(opts.allowedMentions.map((l) => l.toLowerCase()));
  const neutralize = (part: string) =>
    part.replace(MENTION, (match, before: string, name: string) =>
      !name.includes('/') && allowed.has(name.toLowerCase()) ? match : `${before}\`@${name}\``,
    );
  // split() with a capturing group puts the code parts at the odd indexes; only the rest changes.
  out = out.split(CODE).map((part, i) => (i % 2 === 1 ? part : neutralize(part))).join('');

  return out.length > opts.maxLength ? `${out.slice(0, opts.maxLength - 1)}…` : out;
}

/**
 * Remove comments, images and tags, over and over until nothing changes: a single pass could
 * rebuild one from nested input like `<<b>img …>`. Every pass that changes the text makes it
 * shorter, so the loop always ends.
 */
function stripMarkup(text: string): string {
  let out = text;
  let before: string;
  do {
    before = out;
    out = out.replace(/<!--[\s\S]*?-->/g, ''); // HTML comments could forge our hidden marker
    out = out.replace(/<!--/g, ''); // an unclosed one too: it would hide the rest of the post
    out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images: keep the alt text, drop the URL
    out = out.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1'); // reference-style images
    out = out.replace(/<\/?[A-Za-z][^>]*>/g, ''); // raw HTML tags
  } while (out !== before);
  return out;
}
