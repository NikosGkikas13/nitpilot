# Key rotation: changing `ENCRYPTION_KEY` without losing what it locked

**In one sentence:** to swap the encryption key, the server briefly knows two keys, reads with either, writes only with the new one, and rewrites everything stored onto the new key the moment it starts.

## The problem

People's GitHub tokens and the GitHub App's private key and secrets are stored encrypted with `ENCRYPTION_KEY` ([security-primitives.md](security-primitives.md)). AES-GCM only decrypts with the exact key that encrypted, so simply putting a new key in `.env` would make every stored secret unreadable: nobody could sign in, and the server would refuse to start because it can't read its own GitHub App.

But sometimes the key has to change: it was pasted somewhere it shouldn't be, or someone who had it left. A leaked key plus a database backup is every token in the clear.

## The React analogy

Think of a data migration in `localStorage`: you ship a version that can still read the old format but always writes the new one, and on load it rewrites anything still in the old format. Once everyone has loaded once, you delete the old-format reader. Same here, with keys instead of formats.

## How Nitpilot does it

- **`ENCRYPTION_KEY_PREVIOUS`** (optional, only during a rotation). `decrypt` tries `ENCRYPTION_KEY` first, then this one. `encrypt` only ever uses `ENCRYPTION_KEY` (`apps/server/src/lib/crypto.ts`).
- **A step at boot** (`apps/server/src/setup/rotate-key.ts`, called from `main.ts`). When `ENCRYPTION_KEY_PREVIOUS` is set, it goes through every encrypted column (`GithubAuth.accessTokenEnc` and `refreshTokenEnc`, `GithubAppConfig.privateKeyEnc`, `clientSecretEnc` and `webhookSecretEnc`) and rewrites each value still on the old key. It logs `[keys] re-encrypted N stored values`.
- **One transaction.** Either every value moves or none does. If a value can't be read with either key, the server stops instead of starting half-rotated, and nothing is changed.
- **Safe to repeat.** A value already on the new key is left alone, so restarting with `ENCRYPTION_KEY_PREVIOUS` still set just logs `re-encrypted 0`.
- **Nothing races it.** It runs after the server takes its one-server-per-database lock ([one-process.md](one-process.md)) and before anything reads a token.

Then you remove `ENCRYPTION_KEY_PREVIOUS` and restart: the old key no longer opens anything in the database. (Old backups were made with the old key, so they still need it; keep it with them, or let them age out.)

The sign-in cookie (10 minutes) is also encrypted with the key; during the rotation it keeps working because `decrypt` still accepts the old key.

The steps on a server: "Rotating ENCRYPTION_KEY" in [hosting.md](../hosting.md) (nitpilot.dev) and [self-hosting.md](../self-hosting.md).
