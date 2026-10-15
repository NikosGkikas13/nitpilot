// Where the Playwright tests' server listens (apps/server/test/e2e/web-server.ts): the app and its API on one
// port, the tests' control API on another.
export const WEB_PORT = 4319;
export const CONTROL_PORT = 4320;
export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;
