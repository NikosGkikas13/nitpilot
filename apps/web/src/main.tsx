import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/fragment-mono/400.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { applyTheme, readTheme } from './theme';

// Before React renders, so the first render already has the saved theme. A cold load can still show light
// briefly before this runs (the script loads after the page's CSS); whether a small inline script in
// index.html should close that gap is up to the server's Content-Security-Policy (Task 2).
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
