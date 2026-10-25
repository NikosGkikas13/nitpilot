// Where the Playwright tests' server listens (apps/server/test/e2e/web-server.ts): the app and its API on one
// port, the tests' control API on another.
export const WEB_PORT = 4319;
export const CONTROL_PORT = 4320;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;

// The second server, in first-run mode (apps/server/test/e2e/first-run-server.ts), for first-run.spec.ts: the app on
// one port, and on the other the tests' control API, which is also the stand-in for github.com.
export const FIRST_RUN_WEB_PORT = 4321;
export const FIRST_RUN_CONTROL_PORT = 4322;
export const FIRST_RUN_BASE_URL = `http://127.0.0.1:${FIRST_RUN_WEB_PORT}`;
export const FIRST_RUN_CONTROL_URL = `http://127.0.0.1:${FIRST_RUN_CONTROL_PORT}`;
