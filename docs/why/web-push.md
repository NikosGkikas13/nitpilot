# Web Push: notifications when the tab is closed

**In one sentence:** when someone is needed, the server asks each of their browsers' push services to wake that browser and show a notification, even with every Nitpilot tab closed; the CLI only alerts the people no push reached, so nobody gets the same ping twice.

The code: `apps/server/src/tasks/push-notifier.ts` (who gets what, and keeping the subscriptions tidy), `tasks/web-push-send.ts` (one send), `tasks/notifier.ts` (`FallbackNotifier`: push first, then the CLI), `http/routes/push.ts` (saving a browser's subscription).

## What a push service is

A web page can't keep a connection open to our server once its tab is closed. Browsers solve that for every site at once: each browser keeps one connection to its maker's **push service** (Google's FCM for Chrome, Mozilla's for Firefox, Apple's for Safari). A site that wants to notify you sends its message to that service, and the service passes it on to your browser, which wakes the site's **service worker** (a small script the browser runs in the background: `docs/why/service-workers-and-pwa.md`) to show it.

When you turn push on, the browser hands the page a **subscription**: an `endpoint` (a URL at the push service that means "this browser, this site") and two keys. The web app sends that to `POST /api/push/subscriptions`, and the server keeps one `PushSubscription` row per endpoint. Your laptop's Chrome and your phone are two rows.

In React terms: the endpoint is like a callback ref someone gave you. You can't call into their component, but you can call the function they handed you, and it runs on their side.

Because the server POSTs to whatever endpoint a browser hands it, `isPushEndpoint` (in the protocol package) only accepts an `https:` address whose host is a name, not an IP address and not `localhost`: otherwise a signed-in user could make the server call its own neighbours (`127.0.0.1`, a cloud's `169.254.169.254`). It checks the URL only, so it can't see where a public name resolves. But the send is https with certificate checking, so a name that points at a private address only gets a TLS failure unless that address serves a valid certificate for the name, and the server reads nothing from the answer but its status.

## What VAPID keys prove

Anyone who learns an endpoint could POST to it. So the push service only accepts messages signed by the site the browser subscribed for. That's **VAPID**: the server has a key pair (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` in `.env`, made once with `npm run vapid:keys`). The browser subscribes with the public key (the web app gets it from `GET /api/me`, `push.vapidPublicKey`), and every send is signed with the private key. The push service checks the signature against the key the subscription was made with. `VAPID_SUBJECT` is a `mailto:` or `https:` contact the push service can use if our server misbehaves.

The private key is a secret, like `ENCRYPTION_KEY`. A new pair means every browser has to subscribe again, so make it once per server. No keys at all is fine: push is off, `push.vapidPublicKey` is null, and the CLI notifies everyone as in Plan 1.

## Why the payload is encrypted

The message passes through Google's, Mozilla's or Apple's servers on its way. It names your PR and its repo. So it's encrypted for the browser alone: the subscription's two keys (`p256dh`, a public key of the browser's, and `auth`, a shared secret) let the server encrypt it so that only that browser can read it. The push service carries a locked box. The `web-push` package does the signing and the encryption; `tasks/web-push-send.ts` is just a call to it.

What's in the box (`PushPayload`): `{ title, body, url, tag }`, the handoff's copy ("Ready for your approval" · "acme/shop-api#142"), the chat's link for a click, and the chat id as the tag, so a newer notification about the same chat replaces the older one instead of piling up.

Two more options on every send: the push service keeps a message for a phone that's switched off for a day at most (`TTL`), and a push service that stops answering is given up on after 10 seconds, so it can't hold up the notify task.

## What 404 and 410 mean

The push service answers each send. `201`: delivered (or queued for a sleeping phone). `404` or `410`: **this subscription doesn't exist any more**. The person cleared the site's data, took back the permission, or uninstalled the browser. It won't come back, so the row is deleted at once.

Any other answer from the push service (`429` too many requests, `500`) may pass, so it only adds 1 to the row's `failCount`. A success sets it back to 0. A row that gets 5 failed answers in a row is deleted, so a dead endpoint that never says 410 doesn't get tried forever. A send that got **no answer** (a timeout, a network error) doesn't count: that is usually our own side (the server's network is down), and five of those would otherwise wipe everyone's subscriptions. For the same reason the keys are checked at start-up: a `VAPID_PRIVATE_KEY` that isn't the pair of `VAPID_PUBLIC_KEY` stops the server from starting, instead of making every send fail later.

A failed send never stops the others: each subscription is tried on its own, and the notify task fails (and is retried) only if the database does. A retry can push a second time to someone the first attempt already reached; that's accepted, since it needs a database failure in the middle of a send.

## Push first, the CLI as fallback

Spec §16: nobody should get each ping twice, and someone with a CLI online should never get none. So a notification goes out in this order (`FallbackNotifier`):

1. **Web Push** to every subscription of every person it's for. A person is **reached** if at least one of their pushes arrived.
2. **The CLI**, to everyone: its terminal line (`🔔 Ready for your approval: …`) is always printed, it's the log of what happened. But the `notify` message carries `alert`: `false` for the people push reached, so their CLI shows no OS notification, and `true` for the rest, whose CLI shows one, as in Plan 1.

So for each person, one ping that makes a sound: a push, or the CLI's notification. The test "gives each person exactly one alerting ping" in `push-notifier.db.test.ts` checks it with three people: one whose only subscription answers 410 (deleted, and the CLI alerts), one with a working and a gone subscription (push reaches them, the CLI only prints), and one who never turned push on (the CLI alerts).

In React terms: it's an error boundary with a fallback, except the fallback always renders a little (the terminal line) and only renders loudly when the primary failed.
