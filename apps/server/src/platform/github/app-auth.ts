import { createSign } from 'node:crypto';
import type { GithubClient } from './client';

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * A GitHub App proves who it is with a short-lived JWT signed by its private key.
 * Backdated 60 s because GitHub allows that much clock drift; valid for 9 minutes (max 10).
 */
export function createAppJwt(appId: string, privateKeyPem: string, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000) - 60;
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iat, exp: iat + 9 * 60, iss: appId })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem).toString('base64url');
  return `${unsigned}.${signature}`;
}

/** App-level credentials: the JWT, and per-installation tokens (1 hour) used to act as the app bot. */
export class AppAuth {
  private readonly cache = new Map<string, { token: string; expiresAt: number }>();

  constructor(
    private readonly github: GithubClient,
    private readonly appId: string,
    private readonly privateKeyPem: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  jwt(): string {
    return createAppJwt(this.appId, this.privateKeyPem, this.now());
  }

  async installationToken(installationId: string): Promise<string> {
    const cached = this.cache.get(installationId);
    if (cached && cached.expiresAt - this.now().getTime() > 5 * 60_000) return cached.token;
    const { data } = await this.github.api<{ token: string; expires_at: string }>('POST', `/app/installations/${installationId}/access_tokens`, { token: this.jwt() });
    this.cache.set(installationId, { token: data.token, expiresAt: new Date(data.expires_at).getTime() });
    return data.token;
  }
}
