import webpush from 'web-push';

// Make the server's Web Push key pair (VAPID, spec §16, docs/why/web-push.md) for apps/server/.env. Run it once per
// server: every browser subscribes with the public key, so a new pair means everyone has to turn push on again.
// The private key is a secret, like ENCRYPTION_KEY: it lives only in the server's environment.

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`# Web Push (npm run vapid:keys). Put a contact for the push services in VAPID_SUBJECT.
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com`);
