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
  /** The hosted instance (Plan 3), which reviews public repos only; the setup checklist names it. */
  hostedDomain: 'nitpilot.dev',
  /** Where the code and docs live; the web app's landing page links here. */
  repoUrl: 'https://github.com/NikosGkikas13/nitpilot',
} as const;
