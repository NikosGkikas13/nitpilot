/** WebSocket close codes the server uses (spec §10). */
export const CLOSE_CODES = {
  /** The CLI token is invalid or revoked: run `nitpilot login` again. */
  reauth: 4401,
  /** The CLI speaks an old protocol: upgrade it. */
  upgradeCli: 4426,
  /** Another connection with the same CLI token took over (a second `nitpilot start` on this device): stop. */
  replaced: 4409,
  /** The server is restarting: reconnect. */
  serverRestart: 1012,
} as const;
