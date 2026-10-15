import { z } from 'zod';

// By default zod tries `new Function(...)` to compile faster validators. The server's Content-Security-Policy
// (apps/server/src/http/spa.ts) forbids evaluating strings as code, so the browser would log an error on every
// page load, even though zod falls back and nothing breaks. `jitless` skips the attempt.
// This must run before any schema is created, which is why main.tsx imports it first.
z.config({ jitless: true });
