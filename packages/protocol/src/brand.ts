/**
 * Every name-bearing string in Nitpilot lives here, so a rename is a one-line change.
 * Never hard-code "nitpilot" anywhere else.
 */
export const BRAND = {
  name: 'Nitpilot',
  cli: 'nitpilot',
  npmPackage: 'nitpilot',
  configDirName: 'nitpilot',
  envPrefix: 'NITPILOT_',
  teamConfigFile: '.nitpilot.yml',
  tokenPrefix: 'nit_',
  commentMarker: 'nitpilot:v1',
  gitRefNamespace: 'refs/nitpilot',
  commitTrailer: 'Nitpilot-Job',
  mcpServerName: 'nitpilot',
  sessionCookie: 'nitpilot_session',
  oauthCookie: 'nitpilot_oauth',
  userAgent: 'nitpilot',
} as const;
