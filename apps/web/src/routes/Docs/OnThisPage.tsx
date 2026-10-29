import { useEffect, useState } from 'react';
import styles from './Docs.module.css';
import type { Heading } from './markdown';

/** The right-hand rail: a link per heading, with the one being read marked. Hidden by CSS on narrow screens. */
export function OnThisPage({ headings }: { headings: Heading[] }) {
  const [seen, setSeen] = useState<string>();
  // After a page change `seen` may name a heading that no longer exists; fall back to the first.
  const current = headings.some((h) => h.id === seen) ? seen : headings[0]?.id;

  useEffect(() => {
    // jsdom and very old browsers have no IntersectionObserver; the first link just stays current.
    if (typeof window.IntersectionObserver === 'undefined') return;
    // A heading counts as "being read" while it is in the top part of the screen.
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((e) => e.isIntersecting);
        if (entry) setSeen(entry.target.id);
      },
      { rootMargin: '-72px 0px -70% 0px' },
    );
    for (const { id } of headings) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [headings]);

  if (headings.length === 0) return null;
  return (
    <nav className={styles.rail} aria-label="On this page">
      <div className={styles.groupName}>On this page</div>
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          className={`${styles.railLink} ${h.depth === 3 ? styles.railDeep : ''}`}
          aria-current={h.id === current ? 'location' : undefined}
        >
          {h.text}
        </a>
      ))}
    </nav>
  );
}
