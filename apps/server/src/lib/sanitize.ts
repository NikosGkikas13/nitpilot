import { BRAND } from '@nitpilot/protocol';

const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  new RegExp(`\\b${BRAND.tokenPrefix}[A-Za-z0-9_-]{43}`, 'g'),
];

// An @name GitHub turns into a mention: an @ not preceded by a letter, digit or underscore
// (so emails are safe), then a login, or an org/team.
const MENTION = /(?<!\w)@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9_.-]+)?)/g;

// Fenced code blocks and inline code. GitHub never turns @names inside them into mentions.
// A backtick escaped with \ is plain text, so it can't open one.
const CODE = /((?<!\\)```[\s\S]*?```|(?<!\\)`[^`\n]*`)/;

// GitHub decodes HTML entities before it looks for mentions, so `&#64;name` and `@&#110;ame` ping too.
const ENTITY = /&commat;|&#(?:(\d{1,7})|[xX]([0-9a-fA-F]{1,6}));/g;
const MENTION_CHAR = /^[A-Za-z0-9@/._-]$/;

// Goes right after the @ of a neutralized mention. It's invisible, but GitHub needs a name
// character straight after the @, so it no longer sees a mention, however the backticks pair up.
const ZERO_WIDTH_SPACE = '\u200B';

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
  // Cut first, then neutralize: a cut can shorten an allowed @maya into a stranger's @ma, or break
  // a code span open so its @name is plain text again. Neutralizing makes the text longer, so when
  // the result doesn't fit, cut that much more and try again.
  let budget = opts.maxLength;
  for (;;) {
    const cut = out.length > budget ? `${out.slice(0, Math.max(budget - 1, 0))}…` : out;
    const result = neutralizeMentions(cut, allowed);
    if (result.length <= opts.maxLength || budget <= 1) return result;
    budget -= result.length - opts.maxLength;
  }
}

/** Neutralize every mention outside code, except those of the people in the PR. */
function neutralizeMentions(text: string, allowed: Set<string>): string {
  const neutralize = (part: string) =>
    decodeMentionEntities(part).replace(MENTION, (match, name: string) =>
      !name.includes('/') && allowed.has(name.toLowerCase()) ? match : `\`@${ZERO_WIDTH_SPACE}${name}\``,
    );
  // split() with a capturing group puts the code parts at the odd indexes; only the rest changes.
  return text.split(CODE).map((part, i) => (i % 2 === 1 ? part : neutralize(part))).join('');
}

/** Decode the entities that spell part of a mention (`&#64;`, `&#115;`, …). Every other entity stays as it is. */
function decodeMentionEntities(text: string): string {
  return text.replace(ENTITY, (entity, decimal?: string, hex?: string) => {
    if (entity === '&commat;') return '@';
    const code = decimal !== undefined ? Number(decimal) : parseInt(hex ?? '', 16);
    if (!Number.isInteger(code) || code > 0x10ffff) return entity;
    const char = String.fromCodePoint(code);
    return MENTION_CHAR.test(char) ? char : entity;
  });
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
