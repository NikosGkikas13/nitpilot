import 'dotenv/config';
import { spawn } from 'node:child_process';
import { getEnv } from '../src/lib/env';
import { AppAuth } from '../src/platform/github/app-auth';
import { GithubClient } from '../src/platform/github/client';

// Expose the local server through a free Cloudflare quick tunnel (no account needed) and point the
// GitHub App's webhook URL at it (spec §17). Requests arrive byte for byte, so the HMAC check runs
// exactly as in production. Needs `cloudflared` (macOS: brew install cloudflared).

const env = getEnv();
const github = new GithubClient();
const auth = new AppAuth(github, env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${env.PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });

let pointed = false;
async function onOutput(chunk: Buffer): Promise<void> {
  process.stderr.write(chunk);
  const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
  if (!match || pointed) return;
  pointed = true;
  const url = `${match[0]}/webhooks/github`;
  await github.api('PATCH', '/app/hook/config', { token: auth.jwt(), body: { url, content_type: 'json', secret: env.GITHUB_WEBHOOK_SECRET } });
  console.log(`\n✓ ${env.GITHUB_APP_SLUG} now sends webhooks to ${url}\n  Leave this running. Ctrl-C stops the tunnel.\n`);
}

tunnel.stdout.on('data', (c: Buffer) => void onOutput(c).catch((err) => console.error(err)));
tunnel.stderr.on('data', (c: Buffer) => void onOutput(c).catch((err) => console.error(err)));
tunnel.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => tunnel.kill('SIGINT'));
