import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource/fragment-mono/400.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { applyTheme, readTheme } from './theme';

// Before the first paint, so a dark choice never flashes light.
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
