# Trusting a proxy (who is really calling?)

**In one sentence:** on the hosted server every request arrives from our own reverse proxy, so the server reads the real visitor's address from the `X-Forwarded-For` header, but only the last entry of it, and only when `TRUST_PROXY` says a proxy is really there.

## The problem

Nitpilot limits how many `nitpilot login` attempts one address can start a minute (`http/routes/cli.ts`). To do that it needs to know who is calling. The server asks the network connection: "which address is on the other end of this socket?"

In production we run Caddy in front of the server (it handles HTTPS). Caddy receives the visitor's request and makes a **new** request to our server. So the other end of the socket is always Caddy, and every visitor in the world would share one address, and one rate limit.

## X-Forwarded-For

A proxy fixes this by adding a header to the request it passes on: `X-Forwarded-For: <the address I just saw>`. If the request already had that header, the proxy adds its own entry to the **end**: `X-Forwarded-For: 6.6.6.6, 203.0.113.9`.

## Why only the last entry

A header is just text, and the visitor writes the first copy of it. A visitor can send `X-Forwarded-For: 1.2.3.4` themselves, to pretend to be someone else, or a different "someone" on every request to dodge the limit. Only the entry added by **our** proxy is true, and a proxy adds to the end. So the last entry is ours to trust, and everything before it is whatever the client claimed.

React comparison: it is a prop you trust from your own parent component, and nothing else. A value that arrives from outside (the URL, `localStorage`) can say anything; a value your own parent computed is safe.

## Why it is ignored without a proxy

If there is no proxy (a self-hoster running the server directly, or `npm run dev`), nobody adds a true entry, so every `X-Forwarded-For` is the visitor's own claim. Trusting it would let anyone choose their own address. So the server only reads the header when `TRUST_PROXY=true` is set, which the hosted setup does and nothing else should.

## Where

`apps/server/src/lib/client-address.ts` (`clientAddress(c, trustProxy)`), used by the login rate limit in `http/routes/cli.ts`. The flag is `TRUST_PROXY` in `lib/env.ts`.
