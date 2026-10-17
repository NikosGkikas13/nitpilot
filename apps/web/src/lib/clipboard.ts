import { useEffect, useState } from 'react';

/** Copy `text` and say "Copied" for 1.6 s. The command is on screen too, so a clipboard that's missing or refused (an insecure origin) only loses the shortcut. */
export function useCopy(text: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return {
    copied,
    copy: () => {
      navigator.clipboard?.writeText(text).catch(() => {});
      setCopied(true);
    },
  };
}
