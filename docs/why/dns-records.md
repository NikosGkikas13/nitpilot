# DNS records (how a name finds the server)

**In one sentence:** a DNS record is a public entry saying "the name `nitpilot.example.com` means the server at `203.0.113.10`", and a self-hosted Nitpilot needs one before it starts, because browsers, GitHub and Let's Encrypt all find the server by its name.

## The React comparison

An import map in the browser, or `paths` in a `tsconfig.json`: a table that turns a friendly name (`@app/api`) into where the thing really is (`./src/api/index.ts`). Your code only uses the name; change the table and every import follows.

DNS is that table for the whole internet. People and programs use the name; the record says which IP address it means. Move the server to a new machine and you change one record, not every link.

## The records you'll meet

- **A**: name → IPv4 address (`nitpilot.example.com` → `203.0.113.10`). The one a self-hosted server needs.
- **AAAA**: name → IPv6 address. Add it as well if your server has IPv6; otherwise leave it out (a wrong AAAA record breaks visitors who prefer IPv6).
- **CNAME**: name → another name (`www.example.com` → `example.com`), "look that one up instead". Handy for aliases; it can't sit on the bare domain itself.

You add them at whoever runs the domain's DNS (usually where you bought it). The name field is usually just the part before your domain: `nitpilot` for `nitpilot.example.com`, or `@` for the bare domain.

## TTL and "propagation"

Every record has a **TTL** (time to live, in seconds): how long other computers may cache the answer before asking again. Like a `staleTime` in React Query: after a change, anyone holding an old answer keeps using it until it expires.

So a new record usually works within minutes, but a **changed** one can take up to the old TTL to reach everyone. That delay is what people call "propagation". Before moving a server, lower the TTL (to 300, say) a day ahead.

Check what the world sees from your own computer:

```bash
dig +short nitpilot.example.com
```

It prints the address (or nothing, if the record isn't there yet).

## Why Nitpilot needs it right first

- **Let's Encrypt** looks the name up and connects to that address to check you control it, before Caddy can have a certificate ([reverse-proxy-and-tls.md](reverse-proxy-and-tls.md)). A missing or wrong record means no HTTPS.
- **GitHub** sends webhooks, and sends people back after sign-in and install, to URLs built from `PUBLIC_URL` (`https://<NITPILOT_DOMAIN>`), which the first-run page writes into the GitHub App. They are written once, so the domain should be the one you mean to keep.
- **Browsers and CLIs** open `https://<domain>` and connect `wss://<domain>/ws/cli`.

If your DNS provider also offers to proxy traffic (Cloudflare's orange cloud), that proxy is "another HTTPS proxy" in front of Caddy: either switch it to DNS only, or follow "Behind another HTTPS proxy" in `docs/self-hosting.md` (a public proxy like Cloudflare needs its own published address ranges there, not `private_ranges`).

## Where

- `deploy/self-host/.env.example`: `NITPILOT_DOMAIN`, which becomes `PUBLIC_URL` and Caddy's address in `deploy/self-host/docker-compose.yml`.
- `docs/self-hosting.md`, step 1.
- The hosted instance's records for `nitpilot.dev` and `www`: spec §17 "Hosted instance".
