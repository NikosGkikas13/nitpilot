# Reverse proxy and TLS (Caddy, the front door)

**In one sentence:** Caddy is the only thing on a self-hosted server that the internet talks to: it does HTTPS (getting and renewing the certificate by itself) and hands every request on to the Nitpilot server, which never faces the internet directly.

## The React comparison

You already use a reverse proxy in development. In `apps/web/vite.config.ts`, Vite's `server.proxy` sends `/api`, `/auth` and `/ws` on to the server on port 8787 ([serving-a-spa.md](serving-a-spa.md)). The browser only ever talks to Vite on 5173; Vite talks to the server for it.

Caddy is the same idea in production: the browser talks to Caddy on ports 80 and 443, and Caddy talks to `nitpilot:8787` on the private network Docker Compose makes for the folder. The one line that does it, in `deploy/self-host/Caddyfile`:

```
reverse_proxy nitpilot:8787
```

"Reverse" because it stands in front of a server (a normal "forward" proxy stands in front of browsers, like a company's web filter).

## Why not let the server answer the internet itself

- **HTTPS.** Browsers need it (the `.dev` domains are HTTPS-only, and a session cookie marked `Secure` is only sent over it). The Nitpilot server speaks plain HTTP. Caddy adds the encryption on the way in and out, so the server's code never deals with certificates.
- **One door.** Only Caddy publishes ports. The server and Postgres have none in `docker-compose.yml`, so the only way in is through Caddy.

## TLS and certificates, briefly

HTTPS is HTTP inside **TLS**, an encrypted connection. To start one, the server shows a **certificate**: a signed statement "this key belongs to `nitpilot.example.com`", signed by a certificate authority browsers already trust. Without a valid certificate the browser shows a full-page warning.

**Let's Encrypt** is a free certificate authority run by a non-profit, built to be used by programs, not people. Before it signs, it checks that you really control the domain: it connects to the domain on port 80 (or 443) and asks for a one-time answer that only the requester knows. Caddy does all of this on its own the first time it starts with a domain as its address, and renews the certificate before it expires (every few months). It also redirects `http://` to `https://` (the clean-folder run saw a `308` to `https://localhost/healthz`).

That's why the order matters when you set up:

1. **The DNS record first** ([dns-records.md](dns-records.md)): Let's Encrypt looks the domain up, and must land on this server.
2. **Ports 80 and 443 open**: that's where it knocks.
3. **Then `docker compose up -d`.** Started too early, Caddy fails, waits and tries again, and repeated failures can hit Let's Encrypt's rate limits.

Caddy keeps its certificates in the `caddy_data` volume, so a restart or a new image reuses them instead of asking again.

## What Caddy tells the server about the visitor

The server's socket is connected to Caddy, not to the visitor. So Caddy adds headers to every request it passes on, without any configuration:

- `X-Forwarded-For`: the visitor's address. The server uses it for rate limits (five setup-code tries a minute, ten `nitpilot login` starts a minute, per address), and only because `TRUST_PROXY=true` says a proxy is really there ([trusting-a-proxy.md](trusting-a-proxy.md)). Caddy ignores an `X-Forwarded-For` the visitor sent and writes the address it saw, so nobody can pretend to be someone else.
- `X-Forwarded-Proto`: `https` or `http`, how the visitor came in. Sign-in checks it: a sign-in started over plain `http` is sent to the `https` address first, because GitHub always returns people to `PUBLIC_URL`.
- The original `Host`.

WebSockets (`/ws/cli` for CLIs, `/ws/web` for the web app) go through too: Caddy sees the "upgrade to a WebSocket" request and keeps the connection open in both directions.

## `:80` behind another proxy

Sometimes something in front already does HTTPS: a cloud load balancer, a Cloudflare Tunnel, the dev tunnel this project uses for live runs. Then Caddy shouldn't get a certificate (it can't: the visitors never reach it directly). `SITE_ADDRESS=:80` makes Caddy's address "any name, port 80, plain HTTP".

Now the request has two proxies in front of the server, and Caddy's defaults get in the way: it sees the outer proxy as "the visitor", so it writes `X-Forwarded-Proto: http` (the outer proxy connected over plain HTTP) and that proxy's address in `X-Forwarded-For`. The clean-folder run showed what that does: with `PUBLIC_URL=https://…`, every sign-in looked like it came in over `http`, and the server redirected to the `https` address, which arrived as `http` again: a loop.

`TRUSTED_PROXIES` in `.env` fixes it. It goes into the Caddyfile's `trusted_proxies`: requests from those addresses keep the `X-Forwarded-*` headers they bring, so `https` reaches the server. And `header_up X-Forwarded-For {client_ip}` sends the server one address, the real visitor (Caddy reads the incoming header from the right, skipping trusted proxies), not "visitor, outer proxy", whose last entry the server would read as everyone's address. Left empty (directly on the internet) neither changes anything: nobody is trusted, and `{client_ip}` is the connection's own address, which is what Caddy sends anyway.

Trusting a proxy means believing what it says, so only it may reach Caddy's port 80. On the same machine, bind Caddy to `127.0.0.1` (docs/self-hosting.md shows the override file). On a Mac, Docker Desktop also shows a `0.0.0.0`-bound port's clients to containers with an outside address, so the loopback binding is what makes `private_ranges` match there.

## Where

- `deploy/self-host/Caddyfile`: the site address, `reverse_proxy`, `trusted_proxies`, `header_up`.
- `deploy/self-host/docker-compose.yml`: the `caddy` service (ports, `SITE_ADDRESS`, `TRUSTED_PROXIES`, the certificate volumes) and `TRUST_PROXY=true` for the server.
- `apps/server/src/lib/client-address.ts`: reads `X-Forwarded-For`. `apps/server/src/http/routes/auth.ts` (`cameInElsewhere`): reads `X-Forwarded-Proto`.
- `docs/self-hosting.md`: the setup, "Behind another HTTPS proxy", troubleshooting.
