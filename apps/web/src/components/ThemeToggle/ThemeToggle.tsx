import { useState } from 'react';
import { applyTheme, readTheme, shownTheme, systemPrefersDark, writeTheme, type ThemeChoice } from '../../theme';
import styles from './ThemeToggle.module.css';

/** Switches between light and dark, starting from whatever is on screen, and remembers the choice. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme());
  const shown = shownTheme(choice, systemPrefersDark());
  const next = shown === 'dark' ? 'light' : 'dark';

  function toggle() {
    writeTheme(next);
    applyTheme(next);
    setChoice(next);
  }

  return (
    <button type="button" className={styles.toggle} aria-label={`Switch to ${next} theme`} onClick={toggle}>
      {shown === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" strokeLinejoin="round" />
    </svg>
  );
}
