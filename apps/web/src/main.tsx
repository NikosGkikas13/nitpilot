// First: before any zod schema is created (see the file).
import './zod-setup';
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/fragment-mono/400.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { applyTheme, readTheme } from './theme';

// Before React renders, so the first render already has the saved theme. The Content-Security-Policy allows no
// inline scripts (docs/why/content-security-policy.md), so a dark choice on a light system can flash light
// briefly on a cold load. Accepted.
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
