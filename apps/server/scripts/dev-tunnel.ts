import 'dotenv/config';
import { spawn } from 'node:child_process';
import { getEnv } from '../src/lib/env';
import { AppAuth } from '../src/platform/github/app-auth';
import { GithubClient } from '../src/platform/github/client';
import { credentialsFromEnv, type GithubAppCredentials } from '../src/setup/credentials';

// Expose the local server through a free Cloudflare quick tunnel (no account needed) and point the
// GitHub App's webhook URL at it (spec §17). Requests arrive byte for byte, so the HMAC check runs
// exactly as in production. Needs `cloudflared` (macOS: brew install cloudflared).

const env = getEnv();

/** The dev app's six GITHUB_* variables, from .env: the tunnel repoints that app's webhook. */
function devApp(): GithubAppCredentials {
  const app = credentialsFromEnv(env);
  if (app) return app;
  console.error('dev:tunnel needs the dev GitHub App in apps/server/.env (the six GITHUB_* variables).');
  process.exit(1);
}

const app = devApp();
const github = new GithubClient();
const auth = new AppAuth(github, app.appId, app.privateKey);
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${env.PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });

let pointed = false;
async function onOutput(chunk: Buffer): Promise<void> {
  process.stderr.write(chunk);
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
  if (!match || pointed) return;
  pointed = true;
  const url = `${match[0]}/webhooks/github`;
  await github.api('PATCH', '/app/hook/config', { token: auth.jwt(), body: { url, content_type: 'json', secret: app.webhookSecret } });
  console.log(`\n✓ ${app.slug} now sends webhooks to ${url}\n  Leave this running. Ctrl-C stops the tunnel.\n`);
}

tunnel.stdout.on('data', (c: Buffer) => void onOutput(c).catch((err) => console.error(err)));
tunnel.stderr.on('data', (c: Buffer) => void onOutput(c).catch((err) => console.error(err)));
tunnel.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => tunnel.kill('SIGINT'));
